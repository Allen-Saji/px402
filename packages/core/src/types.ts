export interface PaymentTokenPayload {
  /** ULID, matches memo on the PER transfer. */
  paymentId: string;
  /** Amount in the smallest USDC unit (micro-USDC). Integer string. */
  amount: string;
  /** Unix ms when the token expires. */
  expiry: number;
  /** Request path the token was issued for. */
  path: string;
  /** Server's PER ATA the payment is destined for. */
  destination: string;
}

export interface SecretConfig {
  current: string;
  /** Optional second key live during rotation window. */
  previous?: string;
}

export interface Px402CoreConfig {
  /** HMAC secret. String (single key) or {current, previous?} for rotation. */
  serverSecret: string | SecretConfig;
  /** Server's PER ATA that receives payments. */
  destination: string;
  /** Path -> amount-in-micro-USDC (integer). */
  pricing: Record<string, string>;
  /** Token TTL. Default 5 min. */
  tokenTtlMs?: number;
  /** How long a verified tx signature stays in the replay-prevention set. Default 10 min. */
  replayWindowMs?: number;
  /** Rate-limit config. */
  rateLimit?: RateLimitConfig;
}

export interface RateLimitConfig {
  /** Max 402-issuances per IP per window. Default 60. */
  issuePerIpPerMinute?: number;
  /** Max verifications per wallet per window after first successful payment. Default 120. */
  verifyPerWalletPerMinute?: number;
  /** Rolling window in ms. Default 60_000. */
  windowMs?: number;
  /** Max tracked IP/wallet entries before LRU eviction. Default 10_000. */
  maxEntries?: number;
}

export type VerifyOutcome =
  | { status: "verified"; signature: string; amount: string }
  | { status: "pending" }
  | { status: "amount_mismatch"; expected: string; actual: string }
  | { status: "replay" }
  | { status: "rpc_error"; error: string };

export class Px402Error extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "Px402Error";
  }
}

export class InvalidTokenError extends Px402Error {
  constructor(message = "Invalid payment token") {
    super(message, "INVALID_TOKEN");
    this.name = "InvalidTokenError";
  }
}

export class ExpiredTokenError extends Px402Error {
  constructor(message = "Payment token expired") {
    super(message, "EXPIRED_TOKEN");
    this.name = "ExpiredTokenError";
  }
}

export class ReplayError extends Px402Error {
  constructor(message = "Transaction signature already used") {
    super(message, "REPLAY");
    this.name = "ReplayError";
  }
}
