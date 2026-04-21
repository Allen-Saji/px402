import { describe, expect, it } from "vitest";
import { verifyPayment, type VerifiedMemoPayment } from "../src/verify.js";
import type { PaymentTokenPayload } from "../src/types.js";

function payload(overrides: Partial<PaymentTokenPayload> = {}): PaymentTokenPayload {
  return {
    paymentId: "01JN8K7MXZABCDEFGHJKMN0001",
    amount: "10000",
    expiry: Date.now() + 60_000,
    path: "/api/sentiment",
    destination: "3PkQ4JM6WWWEpxoaQtFczYgn47ZkMmdFWySSBfGVVh6v",
    ...overrides,
  };
}

function deps(map: Record<string, VerifiedMemoPayment>, used = new Set<string>()) {
  return {
    lookupByMemo: (m: string) => map[m],
    markSignatureUsed: (sig: string) => {
      if (used.has(sig)) return false;
      used.add(sig);
      return true;
    },
  };
}

describe("verifyPayment", () => {
  it("returns verified when memo matches and amount matches", () => {
    const out = verifyPayment(
      deps({ "01JN8K7MXZABCDEFGHJKMN0001": { signature: "sig1", amount: "10000" } }),
      payload(),
    );
    expect(out.status).toBe("verified");
    if (out.status === "verified") {
      expect(out.signature).toBe("sig1");
      expect(out.amount).toBe("10000");
    }
  });

  it("returns pending when memo not yet indexed", () => {
    const out = verifyPayment(deps({}), payload());
    expect(out.status).toBe("pending");
  });

  it("returns amount_mismatch when amounts differ", () => {
    const out = verifyPayment(
      deps({ "01JN8K7MXZABCDEFGHJKMN0001": { signature: "sig1", amount: "5000" } }),
      payload({ amount: "10000" }),
    );
    expect(out.status).toBe("amount_mismatch");
    if (out.status === "amount_mismatch") {
      expect(out.expected).toBe("10000");
      expect(out.actual).toBe("5000");
    }
  });

  it("returns replay on second verify of same signature", () => {
    const used = new Set<string>();
    const map = { "01JN8K7MXZABCDEFGHJKMN0001": { signature: "sig1", amount: "10000" } };
    const first = verifyPayment(deps(map, used), payload());
    expect(first.status).toBe("verified");
    const second = verifyPayment(deps(map, used), payload());
    expect(second.status).toBe("replay");
  });
});
