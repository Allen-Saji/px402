import type { PaymentTokenPayload, VerifyOutcome } from "./types.js";

export interface VerifiedMemoPayment {
  signature: string;
  /** Amount in micro-USDC (integer string). */
  amount: string;
}

export interface VerifierDeps {
  /** Look up a payment by its memo (paymentId). Returns undefined until seen by the subscribe stream. */
  lookupByMemo(memo: string): VerifiedMemoPayment | undefined;
  /** Record a signature as consumed. Returns true if newly recorded, false if already present (replay). */
  markSignatureUsed(signature: string): boolean;
}

export function verifyPayment(
  deps: VerifierDeps,
  payload: PaymentTokenPayload,
): VerifyOutcome {
  const match = deps.lookupByMemo(payload.paymentId);
  if (!match) return { status: "pending" };

  if (match.amount !== payload.amount) {
    return { status: "amount_mismatch", expected: payload.amount, actual: match.amount };
  }

  if (!deps.markSignatureUsed(match.signature)) {
    return { status: "replay" };
  }

  return { status: "verified", signature: match.signature, amount: match.amount };
}
