import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import type { VerifiedMemoPayment } from "./verify.js";

const MEMO_LOG_RE = /Memo \(len \d+\): "([^"]+)"/;
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_COMMITMENT = "finalized" as const;

export interface SubscriberConfig {
  /** MagicBlock Ephemeral Rollup WebSocket URL (e.g. wss://devnet-as.magicblock.app). */
  wsUrl: string;
  /** Server's PER ATA. Used as logsSubscribe `mentions` filter. */
  destination: string;
  /**
   * Resolves the token-delta amount (micro-USDC) for a signature.
   * Implementations typically call getTransaction and inspect pre/postTokenBalances.
   * Return null if the tx isn't a valid inbound USDC transfer.
   */
  fetchAmount: (signature: string) => Promise<string | null>;
  /** Use "finalized" on ER (inverted commitment vs mainnet). Default: "finalized". */
  commitment?: "processed" | "confirmed" | "finalized";
  /** How long memo entries and used-signatures live. Default 10 min. */
  ttlMs?: number;
  /** Reconnect backoff in ms. Default 1000. */
  reconnectDelayMs?: number;
  /** Logger. Defaults to no-op. */
  logger?: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
}

interface TimedEntry<T> {
  value: T;
  expiresAt: number;
}

export interface SubscriberEvents {
  ready: [];
  memo: [VerifiedMemoPayment & { memo: string }];
  error: [Error];
  reconnecting: [];
}

/**
 * Subscribes to logsSubscribe on a MagicBlock ER and maintains an in-memory
 * memo -> {signature, amount} map. Paired with verifyPayment() for replay-safe
 * payment verification.
 */
export class PerSubscriber extends EventEmitter<SubscriberEvents> {
  private ws: WebSocket | null = null;
  private readonly cfg: Required<Omit<SubscriberConfig, "logger">> & { logger?: SubscriberConfig["logger"] };
  private readonly memoToPayment = new Map<string, TimedEntry<VerifiedMemoPayment>>();
  private readonly usedSignatures = new Map<string, number>();
  private nextRequestId = 1;
  private subscriptionId: number | null = null;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(cfg: SubscriberConfig) {
    super();
    this.cfg = {
      wsUrl: cfg.wsUrl,
      destination: cfg.destination,
      fetchAmount: cfg.fetchAmount,
      commitment: cfg.commitment ?? DEFAULT_COMMITMENT,
      ttlMs: cfg.ttlMs ?? DEFAULT_TTL_MS,
      reconnectDelayMs: cfg.reconnectDelayMs ?? 1000,
      ...(cfg.logger ? { logger: cfg.logger } : {}),
    };
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.once("ready", resolve);
      this.once("error", (err) => {
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED) reject(err);
      });
      this.connect();
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  lookupByMemo(memo: string, now: number = Date.now()): VerifiedMemoPayment | undefined {
    const entry = this.memoToPayment.get(memo);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.memoToPayment.delete(memo);
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
    for (const [k, entry] of this.memoToPayment) {
      if (entry.expiresAt <= now) this.memoToPayment.delete(k);
    }
  }

  private connect(): void {
    const ws = new WebSocket(this.cfg.wsUrl);
    this.ws = ws;

    ws.on("open", () => this.onOpen());
    ws.on("message", (data) => this.onMessage(data.toString()));
    ws.on("error", (err) => {
      this.cfg.logger?.warn(`[px402] ws error: ${err.message}`);
      this.emit("error", err);
    });
    ws.on("close", () => {
      if (this.stopped) return;
      this.cfg.logger?.warn("[px402] ws closed, reconnecting");
      this.emit("reconnecting");
      this.reconnectTimer = setTimeout(() => this.connect(), this.cfg.reconnectDelayMs);
    });
  }

  private onOpen(): void {
    const id = this.nextRequestId++;
    const msg = {
      jsonrpc: "2.0",
      id,
      method: "logsSubscribe",
      params: [
        { mentions: [this.cfg.destination] },
        { commitment: this.cfg.commitment },
      ],
    };
    this.ws?.send(JSON.stringify(msg));
  }

  private onMessage(raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg !== "object" || msg === null) return;
    const m = msg as Record<string, unknown>;

    if (typeof m.id === "number" && typeof m.result === "number") {
      this.subscriptionId = m.result;
      this.cfg.logger?.info(`[px402] logsSubscribe active, id=${this.subscriptionId}`);
      this.emit("ready");
      return;
    }

    if (m.method !== "logsNotification") return;
    const params = m.params as { result?: { value?: { signature?: string; logs?: string[]; err?: unknown } } } | undefined;
    const value = params?.result?.value;
    if (!value || value.err || !value.signature || !Array.isArray(value.logs)) return;

    const memo = this.extractMemo(value.logs);
    if (!memo) return;

    const signature = value.signature;
    void this.resolveAmount(memo, signature);
  }

  private extractMemo(logs: string[]): string | null {
    for (const line of logs) {
      const m = line.match(MEMO_LOG_RE);
      if (m && m[1]) return m[1];
    }
    return null;
  }

  private async resolveAmount(memo: string, signature: string): Promise<void> {
    try {
      const amount = await this.cfg.fetchAmount(signature);
      if (amount === null) return;
      const expiresAt = Date.now() + this.cfg.ttlMs;
      this.memoToPayment.set(memo, { value: { signature, amount }, expiresAt });
      this.emit("memo", { memo, signature, amount });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.cfg.logger?.error(`[px402] fetchAmount failed for ${signature}: ${error.message}`);
    }
  }
}
