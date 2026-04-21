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
  /** Polling interval in ms. Default 1000. */
  pollIntervalMs?: number;
  /** How many sigs to fetch per poll. Default 25. */
  pollLimit?: number;
  /** Commitment for reads. Default "finalized". */
  commitment?: "processed" | "confirmed" | "finalized";
  /** How long tick entries and used-signatures live. Default 10 min. */
  ttlMs?: number;
  /** Optional custom fetch, for tests. */
  fetch?: typeof fetch;
  /** Logger. Defaults to no-op. */
  logger?: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
}

interface TimedEntry<T> {
  value: T;
  expiresAt: number;
}

export interface SubscriberEvents {
  ready: [];
  tick: [TickEvent];
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

export class PrivateTransferSubscriber extends EventEmitter<SubscriberEvents> {
  private readonly cfg: Required<Omit<SubscriberConfig, "logger" | "fetch">> & {
    logger?: SubscriberConfig["logger"];
    fetch: typeof fetch;
  };
  private readonly clientRefIndex = new Map<string, TimedEntry<VerifiedTick>>();
  /** clientRefId -> amount captured from DepositAndQueueTransfer log. */
  private readonly queuedAmounts = new Map<string, TimedEntry<string>>();
  private readonly usedSignatures = new Map<string, number>();
  private readonly processedSigs = new Set<string>();
  private lastSeenSignature: string | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private nextRpcId = 1;

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
      fetch: cfg.fetch ?? fetch,
      ...(cfg.logger ? { logger: cfg.logger } : {}),
    };
  }

  async start(): Promise<void> {
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
    this.schedule();
    this.emit("ready");
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
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
  }

  private schedule(): void {
    if (this.stopped) return;
    this.pollTimer = setTimeout(() => void this.pollOnce(), this.cfg.pollIntervalMs);
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
      if (result.length > 0) {
        this.cfg.logger?.info(`[px402] poll: ${result.length} new sig(s) on queue`);
      }
      if (result.length === 0) return;

      // RPC returns newest-first; advance the watermark immediately so
      // parallel pollOnce invocations never replay work.
      this.lastSeenSignature = result[0]?.signature ?? this.lastSeenSignature;

      const fresh = result.filter((s) => {
        if (this.processedSigs.has(s.signature)) return false;
        this.processedSigs.add(s.signature);
        return !s.err;
      });
      // Oldest-first preserves a stable emit order.
      fresh.reverse();

      // Fan out getTransaction calls with a concurrency cap. Single-threaded
      // processing of 100+ sigs at ~200 ms each blows past the HTTP retry
      // window; parallelism is essential for a busy queue.
      const CONCURRENCY = 16;
      for (let i = 0; i < fresh.length; i += CONCURRENCY) {
        const chunk = fresh.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map((s) => this.inspect(s)));
      }
      if (this.processedSigs.size > 2000) {
        const keep = Array.from(this.processedSigs).slice(-1000);
        this.processedSigs.clear();
        for (const k of keep) this.processedSigs.add(k);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.cfg.logger?.warn(`[px402] poll error: ${error.message}`);
    } finally {
      this.schedule();
    }
  }

  private async inspect(entry: SigEntry): Promise<void> {
    let tx: GetTransactionResult;
    try {
      tx = await this.rpc<GetTransactionResult>("getTransaction", [
        entry.signature,
        { commitment: this.cfg.commitment, maxSupportedTransactionVersion: 0 },
      ]);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.cfg.logger?.warn(`[px402] getTransaction ${entry.signature}: ${error.message}`);
      return;
    }
    const logs = tx.result?.meta?.logMessages ?? [];
    const expiresAt = Date.now() + this.cfg.ttlMs;

    for (const line of logs) {
      const insert = line.match(QUEUE_INSERT_RE);
      if (insert) {
        const [, clientRefId, amount] = insert as unknown as [string, string, string];
        this.queuedAmounts.set(clientRefId, { value: amount, expiresAt });
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
      if (receiver !== this.cfg.receiverWallet) continue;

      // MagicBlock truncates the pop log before amount; recover from the
      // queue-insert log emitted earlier for the same clientRefId.
      const queuedAmount = this.queuedAmounts.get(clientRefId)?.value;
      if (!queuedAmount) {
        this.cfg.logger?.warn(
          `[px402] pop for ref=${clientRefId} seen without a matching queue-insert; skipping`,
        );
        continue;
      }

      const value: VerifiedTick = {
        clientRefId,
        sender,
        receiver,
        amount: queuedAmount,
        signature: entry.signature,
      };
      this.clientRefIndex.set(clientRefId, { value, expiresAt });
      this.emit("tick", { groupId, taskId, slot: entry.slot, ...value });
    }
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const id = this.nextRpcId++;
    const res = await this.cfg.fetch(this.cfg.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    if (!res.ok) {
      throw new Error(`${method} HTTP ${res.status}`);
    }
    const json = (await res.json()) as T & { error?: { message: string } };
    if (json.error) throw new Error(`${method} RPC: ${json.error.message}`);
    return json;
  }
}
