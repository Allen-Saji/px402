import type {
  PaymentTokenPayload,
  Px402CoreConfig,
  RateLimitConfig,
  VerifiedTickRecord,
  VerifyOutcome,
} from "@px402/core";

/**
 * Minimal surface of a subscriber the middleware needs. Lets callers inject
 * a real PrivateTransferSubscriber in production or a fake in tests.
 */
export interface SubscriberLike {
  lookupByClientRefId(clientRefId: string): VerifiedTickRecord | undefined;
  markSignatureUsed(signature: string): boolean;
}

export interface Px402HonoConfig extends Px402CoreConfig {
  /**
   * Server's receiving wallet (base58). Goes into the X-Payment-Address header
   * and becomes the `to` field of /v1/spl/transfer. The MagicBlock API derives
   * the recipient ATA from this wallet pubkey.
   */
  paymentAddress: string;
  /** Subscriber indexed by clientRefId. Usually a PrivateTransferSubscriber. */
  subscriber: SubscriberLike;
  /** Network tag returned on the 402 response. Default: "solana-per". */
  network?: string;
  /** Currency tag. Default "USDC". */
  currency?: string;
  /** Override rate-limit behavior at the adapter level. */
  rateLimit?: RateLimitConfig;
  /** Hook fired when a request is successfully verified. */
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
