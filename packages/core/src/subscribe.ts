import { EventEmitter } from "node:events";

/**
 * Watches the MagicBlock private-transfer queue PDA on the base chain for
 * `ExecuteReadyQueuedTransfer` instructions and emits a verified tick per
 * delivered payment.
 *
 * Each completed transfer surfaces in a single base-chain transaction:
 *
 *   Program DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh invoke [1]
 *     Program SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2 invoke [2]
 *     Program log: Instruction: ExecuteReadyQueuedTransfer
 *     Program log: client_ref_id: <u64>
 *
 * The token transfer is settled inside the same tx and shows up in
 * `meta.preTokenBalances` / `meta.postTokenBalances`. Sender, receiver, and
 * amount are recovered from the balance deltas filtered by `mint`.
 */
const EXECUTE_LINE = "Instruction: ExecuteReadyQueuedTransfer";
const CLIENT_REF_RE = /client_ref_id:\s*(\d+)/;

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 500;
/**
 * Safety cap per poll. We pass an `until` watermark to bound how far back the
 * RPC walks, so this only matters on the very first poll after a lost watermark.
 */
const DEFAULT_POLL_LIMIT = 1000;
const DEFAULT_COMMITMENT = "finalized" as const;
const DEFAULT_FETCH_CONCURRENCY = 16;
const DEFAULT_NULL_RESULT_RETRIES = 5;
const STALLED_THRESHOLD_MS = 30_000;
const PROCESSED_SIGS_HIGH_WATER = 2000;
const PROCESSED_SIGS_KEEP = 1000;

export interface TickEvent {
  clientRefId: string;
  sender: string;
  receiver: string;
  /** Amount in the smallest unit of `mint` (e.g. micro-USDC for 6-decimal USDC). */
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
  /** Verified ticks indexed by clientRefId. Bounded by TTL. */
  indexedCount: number;
  /** Signatures consumed by `markSignatureUsed` for replay prevention. */
  usedSigCount: number;
}

export interface StalledEvent {
  lastSuccessfulPollAt: number;
  error: Error;
}

export interface SubscriberConfig {
  /**
   * Base-chain JSON-RPC URL (http/https). The crank executes queued private
   * transfers on the base chain via `ExecuteReadyQueuedTransfer`, so the
   * subscriber polls `getSignaturesForAddress` + `getTransaction` against the
   * base RPC, not the ephemeral rollup.
   */
  rpcUrl: string;
  /** Queue PDA = PDA(["queue", mint, validator], SPL-PP). */
  queuePda: string;
  /** Token mint used to filter the balance deltas (e.g. USDC mint). */
  mint: string;
  /** Only emit ticks whose recipient ATA owner matches this wallet. */
  receiverWallet: string;
  /** Polling interval in ms. Default 500. */
  pollIntervalMs?: number;
  /** How many sigs to fetch per poll. Default 1000. */
  pollLimit?: number;
  /** Commitment for reads. Default "finalized". */
  commitment?: "processed" | "confirmed" | "finalized";
  /** How long tick entries and used-signatures live. Default 10 min. */
  ttlMs?: number;
  /** Parallel fetch concurrency per chunk. Default 16. */
  fetchConcurrency?: number;
  /** Max getTransaction retries on null result before giving up. Default 5. */
  nullResultRetries?: number;
  /** Optional custom fetch, for tests. */
  fetch?: typeof fetch;
  /** Logger. Defaults to no-op. */
  logger?: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
  /**
   * Pre-seed the watermark instead of starting at the current tip. Useful for
   * deliberate replay (recovery from a known checkpoint) or for tests that
   * need to drive a specific signature range deterministically.
   * The first poll will return sigs newer than this signature.
   */
  initialWatermark?: string;
  /**
   * Fired after each successful poll where the watermark advanced. Adopters
   * persist the signature here (disk, Redis, DB) so that on restart they can
   * pass it back via `initialWatermark` to resume from the last known point
   * instead of dropping payments landed during the crash window.
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

interface ParsedTick {
  clientRefId: string;
  sender: string;
  receiver: string;
  amount: string;
  signature: string;
  slot: number;
  txOrder: number;
}

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

interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}

interface GetTransactionResult {
  jsonrpc: "2.0";
  result?: {
    slot: number;
    meta?: {
      err?: unknown;
      logMessages?: string[];
      preTokenBalances?: TokenBalance[];
      postTokenBalances?: TokenBalance[];
    };
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
  private readonly usedSignatures = new Map<string, number>();
  private readonly processedSigs = new Set<string>();
  /** Per-sig retry counter for getTransaction calls returning null result. */
  private readonly nullResultRetries = new Map<string, number>();
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
      mint: cfg.mint,
      receiverWallet: cfg.receiverWallet,
      pollIntervalMs: cfg.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      pollLimit: cfg.pollLimit ?? DEFAULT_POLL_LIMIT,
      commitment: cfg.commitment ?? DEFAULT_COMMITMENT,
      ttlMs: cfg.ttlMs ?? DEFAULT_TTL_MS,
      fetchConcurrency: cfg.fetchConcurrency ?? DEFAULT_FETCH_CONCURRENCY,
      nullResultRetries: cfg.nullResultRetries ?? DEFAULT_NULL_RESULT_RETRIES,
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
    return {
      lastSuccessfulPollAt: this.lastSuccessfulPollAt,
      indexedCount: this.clientRefIndex.size,
      usedSigCount: this.usedSignatures.size,
    };
  }

  private sweep(now: number): void {
    for (const [k, exp] of this.usedSignatures) {
      if (exp <= now) this.usedSignatures.delete(k);
    }
    for (const [k, entry] of this.clientRefIndex) {
      if (entry.expiresAt <= now) this.clientRefIndex.delete(k);
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
   * Process a chunk of fresh signatures:
   *   Phase A — parallel fetch txs (network IO concurrent for speed)
   *   Phase B — local parse into ParsedTick[] without state mutation
   *   Phase C — sort events by (slot ASC, txOrder ASC) for deterministic apply
   *   Phase D — apply sequentially (index + emit)
   *
   * Throws on RPC failure that prevents any progress; the caller stops
   * processing further chunks and the watermark stays put.
   */
  private async processChunk(chunk: SigEntry[]): Promise<void> {
    const fetched = await this.fetchChunkTxs(chunk);

    const ticks: ParsedTick[] = [];
    for (const item of fetched) {
      if (!item.tx) continue;
      const tick = this.extractTick(item);
      if (tick) ticks.push(tick);
    }

    ticks.sort((a, b) => {
      if (a.slot !== b.slot) return a.slot - b.slot;
      return a.txOrder - b.txOrder;
    });

    const expiresAt = Date.now() + this.cfg.ttlMs;
    for (const tick of ticks) {
      this.applyTick(tick, expiresAt);
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

  /**
   * Returns a ParsedTick when the tx contains a complete
   * `ExecuteReadyQueuedTransfer` to our receiver wallet on our mint, undefined
   * otherwise. Quietly skips txs that don't match (other receivers, other
   * mints, or unrelated SPL-PP instructions).
   */
  private extractTick(item: FetchedTx): ParsedTick | undefined {
    if (!item.tx) return undefined;
    const logs = item.tx.meta?.logMessages ?? [];
    if (!logs.some((l) => l.includes(EXECUTE_LINE))) return undefined;

    let clientRefId: string | undefined;
    for (const line of logs) {
      const m = line.match(CLIENT_REF_RE);
      if (m?.[1]) {
        clientRefId = m[1];
        break;
      }
    }
    if (!clientRefId) {
      this.cfg.logger?.warn(
        `[px402] sig ${item.entry.signature}: ExecuteReadyQueuedTransfer with no client_ref_id; skipping`,
      );
      return undefined;
    }

    const pre = item.tx.meta?.preTokenBalances ?? [];
    const post = item.tx.meta?.postTokenBalances ?? [];

    // Receiver: an ATA whose owner matches receiverWallet on cfg.mint.
    // Sender: any ATA on cfg.mint whose balance decreased.
    const receiverPost = post.find(
      (b) => b.owner === this.cfg.receiverWallet && b.mint === this.cfg.mint,
    );
    if (!receiverPost) return undefined;

    const receiverPre = pre.find((b) => b.accountIndex === receiverPost.accountIndex);
    const recvDelta =
      BigInt(receiverPost.uiTokenAmount.amount) -
      BigInt(receiverPre?.uiTokenAmount.amount ?? "0");
    if (recvDelta <= 0n) return undefined;

    // Sender: same mint, different owner, balance dropped.
    let sender: string | undefined;
    for (const preBal of pre) {
      if (preBal.mint !== this.cfg.mint) continue;
      if (preBal.owner === this.cfg.receiverWallet) continue;
      const postBal = post.find((b) => b.accountIndex === preBal.accountIndex);
      const preAmt = BigInt(preBal.uiTokenAmount.amount);
      const postAmt = BigInt(postBal?.uiTokenAmount.amount ?? preBal.uiTokenAmount.amount);
      if (postAmt < preAmt && preBal.owner) {
        sender = preBal.owner;
        break;
      }
    }
    if (!sender) {
      this.cfg.logger?.warn(
        `[px402] sig ${item.entry.signature}: receiver delta found but no matching sender; skipping`,
      );
      return undefined;
    }

    return {
      clientRefId,
      sender,
      receiver: this.cfg.receiverWallet,
      amount: recvDelta.toString(),
      signature: item.entry.signature,
      slot: item.tx.slot,
      txOrder: item.txOrder,
    };
  }

  private applyTick(tick: ParsedTick, expiresAt: number): void {
    const value: VerifiedTick = {
      clientRefId: tick.clientRefId,
      sender: tick.sender,
      receiver: tick.receiver,
      amount: tick.amount,
      signature: tick.signature,
    };
    this.clientRefIndex.set(tick.clientRefId, { value, expiresAt });
    this.emit("tick", { ...value, slot: tick.slot });
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
