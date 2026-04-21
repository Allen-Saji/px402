import { describe, expect, it } from "vitest";
import { verifyPayment, type VerifiedTickRecord } from "../src/verify.js";
import type { PaymentTokenPayload } from "../src/types.js";

function payload(overrides: Partial<PaymentTokenPayload> = {}): PaymentTokenPayload {
  return {
    paymentId: "1234567890123456789",
    amount: "10000",
    expiry: Date.now() + 60_000,
    path: "/api/sentiment",
    destination: "8AxCJeRrtfwNVQ5huVoF9cto7Y4Jvw6bP1TUUs2ZnK56",
    ...overrides,
  };
}

function deps(
  map: Record<string, VerifiedTickRecord>,
  used: Set<string> = new Set<string>(),
) {
  return {
    lookupByClientRefId: (id: string) => map[id],
    markSignatureUsed: (sig: string) => {
      if (used.has(sig)) return false;
      used.add(sig);
      return true;
    },
  };
}

describe("verifyPayment", () => {
  it("returns verified when clientRefId matches, receiver matches, and amount is within tolerance", () => {
    const out = verifyPayment(
      deps({
        "1234567890123456789": {
          signature: "sig1",
          sender: "sender",
          receiver: "8AxCJeRrtfwNVQ5huVoF9cto7Y4Jvw6bP1TUUs2ZnK56",
          amount: "9990", // 10 micro below quote: within 1% default
        },
      }),
      payload(),
    );
    expect(out.status).toBe("verified");
    if (out.status === "verified") {
      expect(out.signature).toBe("sig1");
      expect(out.amount).toBe("9990");
    }
  });

  it("returns pending when clientRefId not yet indexed", () => {
    const out = verifyPayment(deps({}), payload());
    expect(out.status).toBe("pending");
  });

  it("returns amount_mismatch when receiver differs from expected destination", () => {
    const out = verifyPayment(
      deps({
        "1234567890123456789": {
          signature: "sig1",
          sender: "sender",
          receiver: "WRONG_WALLET",
          amount: "10000",
        },
      }),
      payload(),
    );
    expect(out.status).toBe("amount_mismatch");
  });

  it("returns amount_mismatch when settled amount falls below tolerance floor", () => {
    const out = verifyPayment(
      deps({
        "1234567890123456789": {
          signature: "sig1",
          sender: "sender",
          receiver: "8AxCJeRrtfwNVQ5huVoF9cto7Y4Jvw6bP1TUUs2ZnK56",
          amount: "5000", // 50% less than quote
        },
      }),
      payload(),
    );
    expect(out.status).toBe("amount_mismatch");
  });

  it("returns replay on second verify of same signature", () => {
    const used = new Set<string>();
    const map = {
      "1234567890123456789": {
        signature: "sig1",
        sender: "sender",
        receiver: "8AxCJeRrtfwNVQ5huVoF9cto7Y4Jvw6bP1TUUs2ZnK56",
        amount: "10000",
      },
    };
    const first = verifyPayment(deps(map, used), payload());
    expect(first.status).toBe("verified");
    const second = verifyPayment(deps(map, used), payload());
    expect(second.status).toBe("replay");
  });
});
