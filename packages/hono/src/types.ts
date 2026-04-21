import type {
  PaymentTokenPayload,
  Px402CoreConfig,
  RateLimitConfig,
  VerifiedMemoPayment,
  VerifyOutcome,
} from "@px402/core";

/**
 * Minimal surface of a PER subscriber the middleware needs. Lets callers inject
 * a real PerSubscriber in production or a fake in tests.
 */
export interface SubscriberLike {
  lookupByMemo(memo: string): VerifiedMemoPayment | undefined;
  markSignatureUsed(signature: string): boolean;
}

export interface Px402HonoConfig extends Px402CoreConfig {
  /** PER subscriber. Usually a PerSubscriber instance from @px402/core. */
  subscriber: SubscriberLike;
  /**
   * Network tag returned on the 402 response. `solana-per` signals the
   * px402 private payment path.
   */
  network?: string;
  /** Currency tag. Default "USDC". */
  currency?: string;
  /** Override rate-limit behavior at the adapter level. */
  rateLimit?: RateLimitConfig;
  /**
   * Hook fired when a request is successfully verified. Useful for logging,
   * analytics, or a payment-history dashboard without running a database.
   */
  onVerified?: (event: VerifiedEvent) => void;
}

export interface VerifiedEvent {
  payload: PaymentTokenPayload;
  signature: string;
  amount: string;
  path: string;
  ip: string;
}

export interface OnVerifyResultEvent {
  payload: PaymentTokenPayload;
  outcome: VerifyOutcome;
}
