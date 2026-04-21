import type { RateLimitConfig } from "./types.js";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface LimitDecision {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

const DEFAULTS = {
  issuePerIpPerMinute: 60,
  verifyPerWalletPerMinute: 120,
  windowMs: 60_000,
  maxEntries: 10_000,
} as const;

/**
 * Sliding-minute bucket rate limiter with LRU eviction.
 *
 * Used by the px402 middleware to:
 * - throttle unauthenticated 402 issuance by IP (DoS vector)
 * - throttle verifications by wallet after first successful payment
 *
 * Not distributed. If you run multiple server replicas, front them with a shared
 * limiter (e.g. Redis) instead.
 */
export class RateLimiter {
  private readonly ipBuckets = new Map<string, Bucket>();
  private readonly walletBuckets = new Map<string, Bucket>();
  private readonly issuePerIp: number;
  private readonly verifyPerWallet: number;
  private readonly windowMs: number;
  private readonly maxEntries: number;

  constructor(cfg: RateLimitConfig = {}) {
    this.issuePerIp = cfg.issuePerIpPerMinute ?? DEFAULTS.issuePerIpPerMinute;
    this.verifyPerWallet = cfg.verifyPerWalletPerMinute ?? DEFAULTS.verifyPerWalletPerMinute;
    this.windowMs = cfg.windowMs ?? DEFAULTS.windowMs;
    this.maxEntries = cfg.maxEntries ?? DEFAULTS.maxEntries;
  }

  checkIssue(ip: string, now: number = Date.now()): LimitDecision {
    return this.tick(this.ipBuckets, ip, this.issuePerIp, now);
  }

  checkVerify(wallet: string, now: number = Date.now()): LimitDecision {
    return this.tick(this.walletBuckets, wallet, this.verifyPerWallet, now);
  }

  private tick(
    store: Map<string, Bucket>,
    key: string,
    limit: number,
    now: number,
  ): LimitDecision {
    let bucket = store.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
    } else {
      store.delete(key);
    }
    bucket.count += 1;
    store.set(key, bucket);

    if (store.size > this.maxEntries) {
      const oldestKey = store.keys().next().value;
      if (oldestKey !== undefined) store.delete(oldestKey);
    }

    const ok = bucket.count <= limit;
    return {
      ok,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterMs: ok ? 0 : Math.max(0, bucket.resetAt - now),
    };
  }
}
