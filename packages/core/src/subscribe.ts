import { EventEmitter } from "node:events";

/**
 * Log lines emitted by the MagicBlock private-transfer crank. Two distinct
 * events appear on the queue PDA:
 *
 *   DepositAndQueueTransfer split 1/1 group_id: 1 task_id: 1
 *     client_ref_id: 42 amount: 9990 delay_ms: 0 ready_at: 1776800000000
 *
 *   ProcessTransferQueueTick group_id: 1 task_id: 1 client_ref_id: 42
 *     sender: <pubkey> receiver: <pubkey> amount: 9990
 *
 * MagicBlock truncates log lines around the 213-character mark. With a u63
 * clientRefId the pop line overflows and the trailing `amount:` field is cut.
 * Amount is recovered from the DepositAndQueue line (which fits) and cross-
 * referenced by clientRefId.
 */
const QUEUE_INSERT_RE =
  /DepositAndQueueTransfer split \d+\/\d+ group_id: \d+ task_id: \d+ client_ref_id: (\d+) amount: (\d+)/;
const QUEUE_POP_RE =
  /ProcessTransferQueueTick group_id: (\d+) task_id: (\d+) client_ref_id: (\d+) sender: (\w+) receiver: (\w+)/;

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 500;
/**
 * Safety cap per poll. The queue sees a constant stream of empty
 * ProcessTransferQueueTick txs; without an `until` watermark any limit is too
 * small. We pass `until` below so this is only a fallback for the very first
 * poll after a watermark is lost.
 */
const DEFAULT_POLL_LIMIT = 1000;
const DEFAULT_COMMITMENT = "finalized" as const;
const DEFAULT_MAX_ORPHANS = 1000;
const DEFAULT_FETCH_CONCURRENCY = 16;
const DEFAULT_NULL_RESULT_RETRIES = 5;
const DEFAULT_BACKWARDS_SCAN_PER_MINUTE = 5;
const STALLED_THRESHOLD_MS = 30_000;
const ORPHAN_RECOVERY_DELAY_MULTIPLIER = 3;
const PROCESSED_SIGS_HIGH_WATER = 2000;
const PROCESSED_SIGS_KEEP = 1000;

export interface TickEvent {
  groupId: string;
  taskId: string;
  clientRefId: string;
  sender: string;
  receiver: string;
  amount: string;
  signature: string;
  slot: number;
}

export interface VerifiedTick {
  clientRefId: string;
  sender: string;
  receiver: string;
  amount: string;
  signature: string;
}

export interface SubscriberStatus {
  /** Wall-clock time of the most recent successful poll. 0 means none yet. */
  lastSuccessfulPollAt: number;
  /** Pops waiting for a matching insert. Should be near zero in steady state. */
  orphanCount: number;
  /** Inserts seen but not yet popped. Bounded by TTL. */
  queuedCount: number;
  /** Verified ticks indexed by clientRefId. Bounded by TTL. */
  indexedCount: number;
  /** Signatures consumed by `markSignatureUsed` for replay prevention. */
  usedSigCount: number;
  /** Backwards-recovery scans performed in the last 60s. */
  recentBackwardsScans: number;
}

export interface StalledEvent {
  lastSuccessfulPollAt: number;
  error: Error;
}

export interface SubscriberConfig {
  /**
   * Ephemeral-rollup JSON-RPC URL (http/https). MagicBlock ER does not deliver
   * logsSubscribe notifications reliably, so the subscriber polls
   * getSignaturesForAddress + getTransaction on an interval.
   */
  rpcUrl: string;
  /** Queue PDA = PDA(["queue", mint, validator], SPL-PP). */
  queuePda: string;
  /** Only emit ticks whose `receiver` matches this wallet. */
  receiverWallet: string;
  /** Polling interval in ms. Default 500. */
  pollIntervalMs?: number;
  /** How many sigs to fetch per poll. Default 1000. */
  pollLimit?: number;
  /** Commitment for reads. Default "finalized". */
  commitment?: "processed" | "confirmed" | "finalized";
  /** How long tick entries, queued amounts, and used-signatures live. Default 10 min. */
  ttlMs?: number;
  /** Max orphan pops buffered. FIFO eviction beyond this. Default 1000. */
  maxOrphans?: number;
  /** Parallel fetch concurrency per chunk. Default 16. */
  fetchConcurrency?: number;
  /** Max getTransaction retries on null result before giving up. Default 5. */
  nullResultRetries?: number;
  /** Max backwards-recovery scans per rolling minute. Default 5. */
  backwardsScansPerMinute?: number;
  /** Optional custom fetch, for tests. */
  fetch?: typeof fetch;
  /** Logger. Defaults to no-op. */
  logger?: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
  /**
   * Pre-seed the watermark instead of starting at the current tip. Useful for
   * deliberate replay (recovery from a known checkpoint) or for tests that
   * need to trigger the orphan-pop / backwards-scan path deterministically.
   * The first poll will return sigs newer than this signature.
   */
  initialWatermark?: string;
  /**
   * Fired after each successful poll where the watermark advanced. Adopters
   * persist the signature here (disk, Redis, DB) so that on restart they can
   * pass it back via `initialWatermark` to resume from the last known point
   * instead of dropping payments that landed during the crash window.
   *
   * Errors are caught, logged, and re-emitted on the `error` event. The
   * subscriber keeps polling either way.
   */
  onWatermarkAdvance?: (signature: string) => void | Promise<void>;
}

interface TimedEntry<T> {
  value: T;
  expiresAt: number;
}

interface OrphanPop {
  groupId: string;
  taskId: string;
  sender: string;
  receiver: string;
  signature: string;
  slot: number;
  bufferedAt: number;
  recoveryAttempted: boolean;
}

type ParsedEvent =
  | {
      kind: "insert";
      clientRefId: string;
      amount: string;
      signature: string;
      slot: number;
      txOrder: number;
    }
  | {
      kind: "pop";
      groupId: string;
      taskId: string;
      clientRefId: string;
      sender: string;
      receiver: string;
      signature: string;
      slot: number;
      txOrder: number;
    };

export interface SubscriberEvents {
  ready: [];
  tick: [TickEvent];
  stalled: [StalledEvent];
  error: [Error];
}

interface SigEntry {
  signature: string;
  slot: number;
  err: unknown;
  blockTime?: number;
}

interface GetSignaturesResult {
  jsonrpc: "2.0";
  result?: SigEntry[];
  error?: { code: number; message: string };
}

interface GetTransactionResult {
  jsonrpc: "2.0";
  result?: {
    slot: number;
    meta?: { err?: unknown; logMessages?: string[] };
  } | null;
  error?: { code: number; message: string };
}

interface FetchedTx {
  entry: SigEntry;
  txOrder: number;
  tx: NonNullable<GetTransactionResult["result"]> | null;
}

export class PrivateTransferSubscriber extends EventEmitter<SubscriberEvents> {
  private readonly cfg: Required<
    Omit<SubscriberConfig, "logger" | "fetch" | "onWatermarkAdvance">
  > & {
    logger?: SubscriberConfig["logger"];
    fetch: typeof fetch;
  };
  private readonly clientRefIndex = new Map<string, TimedEntry<VerifiedTick>>();
  /** clientRefId -> amount captured from DepositAndQueueTransfer log. */
  private readonly queuedAmounts = new Map<string, TimedEntry<string>>();
  private readonly usedSignatures = new Map<string, number>();
  private readonly processedSigs = new Set<string>();
  /** Pop logs seen before their matching insert. Resolved on insert arrival or via backwards-scan. */
  private readonly orphanPops = new Map<string, TimedEntry<OrphanPop>>();
  /** Per-sig retry counter for getTransaction calls returning null result. */
  private readonly nullResultRetries = new Map<string, number>();
  /** Sliding-window timestamps of recent backwards-recovery scans for rate limiting. */
  private readonly backwardsScanTimestamps: number[] = [];
  private lastSeenSignature: string | null = null;
  private lastSuccessfulPollAt = 0;
  private pollTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private nextRpcId = 1;
  /** Promise for the currently-executing poll, if any. Awaited by stop() so callers know shutdown is complete. */
  private inFlightPoll: Promise<void> | null = null;
  /** Aborts in-flight fetches when stop() is called so shutdown doesn't wait on the full HTTP timeout. */
  private abortController: AbortController | null = null;

  private readonly onWatermarkAdvance?: (signature: string) => void | Promise<void>;

  constructor(cfg: SubscriberConfig) {
    super();
    this.cfg = {
      rpcUrl: cfg.rpcUrl,
      queuePda: cfg.queuePda,
      receiverWallet: cfg.receiverWallet,
      pollIntervalMs: cfg.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      pollLimit: cfg.pollLimit ?? DEFAULT_POLL_LIMIT,
      commitment: cfg.commitment ?? DEFAULT_COMMITMENT,
      ttlMs: cfg.ttlMs ?? DEFAULT_TTL_MS,
      maxOrphans: cfg.maxOrphans ?? DEFAULT_MAX_ORPHANS,
      fetchConcurrency: cfg.fetchConcurrency ?? DEFAULT_FETCH_CONCURRENCY,
      nullResultRetries: cfg.nullResultRetries ?? DEFAULT_NULL_RESULT_RETRIES,
      backwardsScansPerMinute: cfg.backwardsScansPerMinute ?? DEFAULT_BACKWARDS_SCAN_PER_MINUTE,
      initialWatermark: cfg.initialWatermark ?? "",
      fetch: cfg.fetch ?? fetch,
      ...(cfg.logger ? { logger: cfg.logger } : {}),
    };
    if (cfg.onWatermarkAdvance) this.onWatermarkAdvance = cfg.onWatermarkAdvance;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.abortController = new AbortController();
    if (this.cfg.initialWatermark) {
      this.lastSeenSignature = this.cfg.initialWatermark;
      this.cfg.logger?.info(
        `[px402] watermark on queue ${this.cfg.queuePda}: ${this.cfg.initialWatermark} (pre-seeded)`,
      );
    } else {
      // Seed the watermark with the current tip so we only report new txs.
      try {
        const sigs = await this.rpc<GetSignaturesResult>("getSignaturesForAddress", [
          this.cfg.queuePda,
          { limit: 1 },
        ]);
        const tip = sigs.result?.[0]?.signature ?? null;
        if (tip) this.lastSeenSignature = tip;
        this.cfg.logger?.info(
          `[px402] watermark on queue ${this.cfg.queuePda}: ${tip ?? "<empty>"}`,
        );
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.emit("error", error);
        throw error;
      }
    }
    this.lastSuccessfulPollAt = Date.now();
    this.schedule();
    this.emit("ready");
  }

  /**
   * Gracefully stop the subscriber. Awaits any in-flight poll so callers know
   * no more `tick` / `error` / `stalled` events will fire after the returned
   * promise resolves. In-flight RPC fetches are aborted via AbortController so
   * shutdown doesn't wait the full HTTP timeout.
   *
   * @param timeoutMs Max wait for in-flight work before force-resolving. Default 5000.
   */
  async stop(timeoutMs = 5000): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    if (this.abortController) this.abortController.abort();
    if (this.inFlightPoll) {
      let timer: NodeJS.Timeout | undefined;
      const timeoutP = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      });
      await Promise.race([this.inFlightPoll.catch(() => undefined), timeoutP]);
      if (timer) clearTimeout(timer);
      this.inFlightPoll = null;
    }
  }

  /**
   * Current poll watermark — the signature of the most-recently-seen tx on the
   * queue PDA. Persist this and pass back via `initialWatermark` on next boot
   * to resume from the same point instead of dropping payments landed during
   * the crash window.
   *
   * Returns null if no successful poll has happened yet.
   */
  getWatermark(): string | null {
    return this.lastSeenSignature;
  }

  lookupByClientRefId(clientRefId: string, now: number = Date.now()): VerifiedTick | undefined {
    const entry = this.clientRefIndex.get(clientRefId);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.clientRefIndex.delete(clientRefId);
      return undefined;
    }
    return entry.value;
  }

  markSignatureUsed(signature: string, now: number = Date.now()): boolean {
    this.sweep(now);
    if (this.usedSignatures.has(signature)) return false;
    this.usedSignatures.set(signature, now + this.cfg.ttlMs);
    return true;
  }

  /** Snapshot of internal state. Intended for health endpoints and metrics scrape. */
  getStatus(): SubscriberStatus {
    const now = Date.now();
    this.pruneBackwardsScans(now);
    return {
      lastSuccessfulPollAt: this.lastSuccessfulPollAt,
      orphanCount: this.orphanPops.size,
      queuedCount: this.queuedAmounts.size,
      indexedCount: this.clientRefIndex.size,
      usedSigCount: this.usedSignatures.size,
      recentBackwardsScans: this.backwardsScanTimestamps.length,
    };
  }

  private sweep(now: number): void {
    for (const [k, exp] of this.usedSignatures) {
      if (exp <= now) this.usedSignatures.delete(k);
    }
    for (const [k, entry] of this.clientRefIndex) {
      if (entry.expiresAt <= now) this.clientRefIndex.delete(k);
    }
    for (const [k, entry] of this.queuedAmounts) {
      if (entry.expiresAt <= now) this.queuedAmounts.delete(k);
    }
    for (const [k, entry] of this.orphanPops) {
      if (entry.expiresAt <= now) this.orphanPops.delete(k);
    }
  }

  private schedule(): void {
    if (this.stopped) return;
    this.pollTimer = setTimeout(() => {
      const p = this.pollOnce();
      this.inFlightPoll = p.finally(() => {
        if (this.inFlightPoll === p) this.inFlightPoll = null;
      });
    }, this.cfg.pollIntervalMs);
  }

  private async pollOnce(): Promise<void> {
    try {
      const params: [string, { limit: number; until?: string }] = [
        this.cfg.queuePda,
        { limit: this.cfg.pollLimit },
      ];
      if (this.lastSeenSignature) params[1].until = this.lastSeenSignature;

      const sigs = await this.rpc<GetSignaturesResult>("getSignaturesForAddress", params);
      const result = sigs.result ?? [];
      const candidateWatermark = result[0]?.signature;

      if (result.length === 0) {
        this.lastSuccessfulPollAt = Date.now();
        await this.recoverEligibleOrphans();
        return;
      }

      this.cfg.logger?.info(`[px402] poll: ${result.length} new sig(s) on queue`);

      const fresh = result.filter((s) => !this.processedSigs.has(s.signature) && !s.err);
      // Oldest first for deterministic apply order. Sorting by slot is the
      // authoritative key during the apply phase below; this just ensures
      // chunk boundaries respect chronology.
      fresh.reverse();

      let allChunksOk = true;
      const concurrency = this.cfg.fetchConcurrency;
      for (let i = 0; i < fresh.length; i += concurrency) {
        if (this.stopped) {
          allChunksOk = false;
          break;
        }
        const chunk = fresh.slice(i, i + concurrency);
        try {
          await this.processChunk(chunk);
        } catch (err) {
          allChunksOk = false;
          if (this.stopped) break;
          const error = err instanceof Error ? err : new Error(String(err));
          this.cfg.logger?.error(`[px402] chunk apply failed: ${error.message}`);
          this.emit("error", error);
          break;
        }
      }

      let watermarkAdvanced = false;
      if (allChunksOk && candidateWatermark && candidateWatermark !== this.lastSeenSignature) {
        this.lastSeenSignature = candidateWatermark;
        watermarkAdvanced = true;
      }

      this.maintainProcessedSigsBound();
      this.lastSuccessfulPollAt = Date.now();

      if (watermarkAdvanced && this.onWatermarkAdvance && !this.stopped) {
        try {
          await this.onWatermarkAdvance(candidateWatermark!);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          this.cfg.logger?.error(`[px402] onWatermarkAdvance failed: ${error.message}`);
          if (!this.stopped) this.emit("error", error);
        }
      }

      await this.recoverEligibleOrphans();
    } catch (err) {
      if (this.stopped) return;
      const error = err instanceof Error ? err : new Error(String(err));
      this.cfg.logger?.warn(`[px402] poll error: ${error.message}`);
      const elapsed = Date.now() - this.lastSuccessfulPollAt;
      if (this.lastSuccessfulPollAt > 0 && elapsed > STALLED_THRESHOLD_MS) {
        this.emit("stalled", { lastSuccessfulPollAt: this.lastSuccessfulPollAt, error });
      }
    } finally {
      if (!this.stopped) this.schedule();
    }
  }

  /**
   * Process a chunk of fresh signatures atomically:
   *   Phase A — parallel fetch txs (network IO concurrent for speed)
   *   Phase B — local parse into ParsedEvent[] without state mutation
   *   Phase C — sort events by (slot ASC, txOrder ASC, kind: insert before pop)
   *   Phase D — apply sequentially. Inserts always land in queuedAmounts before
   *             matching pops read from it within the same chunk.
   *
   * Throws on RPC failure that prevents any progress; the caller stops
   * processing further chunks and the watermark stays put.
   */
  private async processChunk(chunk: SigEntry[]): Promise<void> {
    const fetched = await this.fetchChunkTxs(chunk);

    const events: ParsedEvent[] = [];
    for (const item of fetched) {
      if (!item.tx) continue;
      const txEvents = this.extractEvents(item);
      events.push(...txEvents);
    }

    events.sort((a, b) => {
      if (a.slot !== b.slot) return a.slot - b.slot;
      if (a.txOrder !== b.txOrder) return a.txOrder - b.txOrder;
      // insert before pop within the same tx (they don't share txs in practice)
      if (a.kind !== b.kind) return a.kind === "insert" ? -1 : 1;
      return 0;
    });

    const expiresAt = Date.now() + this.cfg.ttlMs;
    for (const ev of events) {
      this.applyEvent(ev, expiresAt);
    }
  }

  private async fetchChunkTxs(chunk: SigEntry[]): Promise<FetchedTx[]> {
    return Promise.all(
      chunk.map(async (entry, txOrder): Promise<FetchedTx> => {
        let tx: GetTransactionResult;
        try {
          tx = await this.rpc<GetTransactionResult>("getTransaction", [
            entry.signature,
            { commitment: this.cfg.commitment, maxSupportedTransactionVersion: 0 },
          ]);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          this.cfg.logger?.warn(
            `[px402] getTransaction ${entry.signature}: ${error.message} (will retry next poll)`,
          );
          return { entry, txOrder, tx: null };
        }

        if (!tx.result) {
          const retries = (this.nullResultRetries.get(entry.signature) ?? 0) + 1;
          if (retries >= this.cfg.nullResultRetries) {
            this.cfg.logger?.warn(
              `[px402] sig ${entry.signature} returned null after ${retries} attempts; giving up`,
            );
            this.processedSigs.add(entry.signature);
            this.nullResultRetries.delete(entry.signature);
          } else {
            this.nullResultRetries.set(entry.signature, retries);
          }
          return { entry, txOrder, tx: null };
        }

        // Definitive result: safe to mark processed.
        this.processedSigs.add(entry.signature);
        this.nullResultRetries.delete(entry.signature);
        return { entry, txOrder, tx: tx.result };
      }),
    );
  }

  private extractEvents(item: FetchedTx): ParsedEvent[] {
    if (!item.tx) return [];
    const logs = item.tx.meta?.logMessages ?? [];
    const events: ParsedEvent[] = [];
    for (const line of logs) {
      const insert = line.match(QUEUE_INSERT_RE);
      if (insert) {
        const [, clientRefId, amount] = insert as unknown as [string, string, string];
        events.push({
          kind: "insert",
          clientRefId,
          amount,
          signature: item.entry.signature,
          slot: item.tx.slot,
          txOrder: item.txOrder,
        });
        continue;
      }

      const pop = line.match(QUEUE_POP_RE);
      if (!pop) continue;
      const [, groupId, taskId, clientRefId, sender, receiver] = pop as unknown as [
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      events.push({
        kind: "pop",
        groupId,
        taskId,
        clientRefId,
        sender,
        receiver,
        signature: item.entry.signature,
        slot: item.tx.slot,
        txOrder: item.txOrder,
      });
    }
    return events;
  }

  private applyEvent(ev: ParsedEvent, expiresAt: number): void {
    if (ev.kind === "insert") {
      this.queuedAmounts.set(ev.clientRefId, { value: ev.amount, expiresAt });
      const orphanEntry = this.orphanPops.get(ev.clientRefId);
      if (orphanEntry && orphanEntry.expiresAt > Date.now()) {
        const orphan = orphanEntry.value;
        if (orphan.receiver === this.cfg.receiverWallet) {
          this.completeOrphan(ev.clientRefId, orphan, ev.amount, expiresAt);
        }
      }
      this.orphanPops.delete(ev.clientRefId);
      return;
    }

    if (ev.receiver !== this.cfg.receiverWallet) return;

    const queuedAmount = this.queuedAmounts.get(ev.clientRefId)?.value;
    if (queuedAmount) {
      const value: VerifiedTick = {
        clientRefId: ev.clientRefId,
        sender: ev.sender,
        receiver: ev.receiver,
        amount: queuedAmount,
        signature: ev.signature,
      };
      this.clientRefIndex.set(ev.clientRefId, { value, expiresAt });
      this.emit("tick", { groupId: ev.groupId, taskId: ev.taskId, slot: ev.slot, ...value });
      return;
    }

    if (this.orphanPops.size >= this.cfg.maxOrphans) {
      const oldestKey = this.orphanPops.keys().next().value;
      if (oldestKey !== undefined) {
        this.orphanPops.delete(oldestKey);
        this.cfg.logger?.warn(
          `[px402] orphan buffer at capacity (${this.cfg.maxOrphans}); evicted oldest`,
        );
      }
    }

    this.orphanPops.set(ev.clientRefId, {
      value: {
        groupId: ev.groupId,
        taskId: ev.taskId,
        sender: ev.sender,
        receiver: ev.receiver,
        signature: ev.signature,
        slot: ev.slot,
        bufferedAt: Date.now(),
        recoveryAttempted: false,
      },
      expiresAt,
    });
    this.cfg.logger?.info(
      `[px402] orphan pop ref=${ev.clientRefId} buffered (insert not yet seen)`,
    );
  }

  private completeOrphan(
    clientRefId: string,
    orphan: OrphanPop,
    amount: string,
    expiresAt: number,
  ): void {
    const value: VerifiedTick = {
      clientRefId,
      sender: orphan.sender,
      receiver: orphan.receiver,
      amount,
      signature: orphan.signature,
    };
    this.clientRefIndex.set(clientRefId, { value, expiresAt });
    this.emit("tick", { groupId: orphan.groupId, taskId: orphan.taskId, slot: orphan.slot, ...value });
    this.cfg.logger?.info(`[px402] orphan ref=${clientRefId} resolved`);
  }

  private async recoverEligibleOrphans(): Promise<void> {
    const now = Date.now();
    const recoveryDelayMs = ORPHAN_RECOVERY_DELAY_MULTIPLIER * this.cfg.pollIntervalMs;

    this.pruneBackwardsScans(now);
    let remainingBudget = this.cfg.backwardsScansPerMinute - this.backwardsScanTimestamps.length;
    if (remainingBudget <= 0) return;

    for (const [clientRefId, entry] of this.orphanPops) {
      if (remainingBudget <= 0) break;
      if (entry.expiresAt <= now) continue;
      if (entry.value.recoveryAttempted) continue;
      if (now - entry.value.bufferedAt < recoveryDelayMs) continue;

      entry.value.recoveryAttempted = true;
      this.backwardsScanTimestamps.push(Date.now());
      remainingBudget -= 1;

      try {
        await this.recoverOrphan(clientRefId, entry.value);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.cfg.logger?.warn(
          `[px402] orphan recovery ${clientRefId} threw: ${error.message}`,
        );
      }
    }
  }

  private async recoverOrphan(clientRefId: string, orphan: OrphanPop): Promise<void> {
    const limits = [50, 200];
    for (const limit of limits) {
      const params: [string, { limit: number; before: string }] = [
        this.cfg.queuePda,
        { limit, before: orphan.signature },
      ];
      const sigs = await this.rpc<GetSignaturesResult>("getSignaturesForAddress", params);
      const result = sigs.result ?? [];
      if (result.length === 0) continue;

      const concurrency = this.cfg.fetchConcurrency;
      for (let i = 0; i < result.length; i += concurrency) {
        const chunk = result.slice(i, i + concurrency);
        const fetched = await Promise.all(
          chunk.map(async (s) => {
            if (s.err) return null;
            try {
              const tx = await this.rpc<GetTransactionResult>("getTransaction", [
                s.signature,
                { commitment: this.cfg.commitment, maxSupportedTransactionVersion: 0 },
              ]);
              return tx.result ? { sig: s.signature, slot: s.slot, tx: tx.result } : null;
            } catch {
              return null;
            }
          }),
        );

        for (const item of fetched) {
          if (!item) continue;
          const logs = item.tx.meta?.logMessages ?? [];
          for (const line of logs) {
            const insert = line.match(QUEUE_INSERT_RE);
            if (!insert) continue;
            const [, ref, amount] = insert as unknown as [string, string, string];
            if (ref !== clientRefId) continue;

            const expiresAt = Date.now() + this.cfg.ttlMs;
            this.queuedAmounts.set(clientRefId, { value: amount, expiresAt });
            this.completeOrphan(clientRefId, orphan, amount, expiresAt);
            this.orphanPops.delete(clientRefId);
            this.cfg.logger?.info(
              `[px402] orphan ref=${clientRefId} recovered via backwards-scan (limit=${limit})`,
            );
            return;
          }
        }
      }
    }

    this.cfg.logger?.error(
      `[px402] orphan ref=${clientRefId} unrecoverable after backwards-scan`,
    );
    this.emit("error", new Error(`px402: orphan ref=${clientRefId} unrecoverable`));
  }

  private pruneBackwardsScans(now: number): void {
    const cutoff = now - 60_000;
    while (this.backwardsScanTimestamps.length > 0) {
      const oldest = this.backwardsScanTimestamps[0];
      if (oldest === undefined || oldest >= cutoff) break;
      this.backwardsScanTimestamps.shift();
    }
  }

  private maintainProcessedSigsBound(): void {
    if (this.processedSigs.size > PROCESSED_SIGS_HIGH_WATER) {
      const keep = Array.from(this.processedSigs).slice(-PROCESSED_SIGS_KEEP);
      this.processedSigs.clear();
      for (const k of keep) this.processedSigs.add(k);
    }
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const id = this.nextRpcId++;
    const signal = this.abortController?.signal;
    const res = await this.cfg.fetch(this.cfg.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      throw new Error(`${method} HTTP ${res.status}`);
    }
    const json = (await res.json()) as T & { error?: { message: string } };
    if (json.error) throw new Error(`${method} RPC: ${json.error.message}`);
    return json;
  }
}
