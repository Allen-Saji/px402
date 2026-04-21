import type { PaymentTokenPayload, VerifyOutcome } from "./types.js";

export interface VerifiedTickRecord {
  signature: string;
  sender: string;
  receiver: string;
  /** Amount in micro-USDC (integer string). Already net of MagicBlock's fee. */
  amount: string;
}

export interface VerifierDeps {
  /** Look up a tick by its clientRefId. Returns undefined until the crank fires. */
  lookupByClientRefId(clientRefId: string): VerifiedTickRecord | undefined;
  /** Record a signature as consumed. Returns false if already present (replay). */
  markSignatureUsed(signature: string): boolean;
}

/**
 * Verify a payment against the indexed crank-tick stream.
 *
 * The amount check uses the quoted amount as the lower bound since MagicBlock's
 * protocol fee is deducted from the payout. Caller-provided tolerance (defaults
 * to 1%) allows for that fee without asking adopters to encode the exact
 * schedule.
 */
export function verifyPayment(
  deps: VerifierDeps,
  payload: PaymentTokenPayload,
  options: { amountToleranceBps?: number } = {},
): VerifyOutcome {
  const match = deps.lookupByClientRefId(payload.paymentId);
  if (!match) return { status: "pending" };

  if (match.receiver !== payload.destination) {
    return {
      status: "amount_mismatch",
      expected: `${payload.destination} / ${payload.amount}`,
      actual: `${match.receiver} / ${match.amount}`,
    };
  }

  const toleranceBps = options.amountToleranceBps ?? 100; // 1%
  const quoted = BigInt(payload.amount);
  const settled = BigInt(match.amount);
  const floor = quoted - (quoted * BigInt(toleranceBps)) / 10_000n;
  if (settled < floor) {
    return {
      status: "amount_mismatch",
      expected: payload.amount,
      actual: match.amount,
    };
  }

  if (!deps.markSignatureUsed(match.signature)) {
    return { status: "replay" };
  }

  return { status: "verified", signature: match.signature, amount: match.amount };
}
