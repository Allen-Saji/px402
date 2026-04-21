import type { VerifiedTickRecord } from "@px402/core";
import { NextResponse, type NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { withPx402 } from "../src/handler.js";

const PAYMENT_ADDRESS = "8AxCJeRrtfwNVQ5huVoF9cto7Y4Jvw6bP1TUUs2ZnK56";
const PRICE = "10000";
const ROUTE = "http://localhost/api/sentiment";

class FakeSubscriber {
  public index = new Map<string, VerifiedTickRecord>();
  public used = new Set<string>();
  lookupByClientRefId(id: string) { return this.index.get(id); }
  markSignatureUsed(sig: string) {
    if (this.used.has(sig)) return false;
    this.used.add(sig);
    return true;
  }
}

function buildHandler(subscriber = new FakeSubscriber()) {
  return {
    subscriber,
    handler: withPx402(
      {
        serverSecret: "test-secret",
        paymentAddress: PAYMENT_ADDRESS,
        pricing: { "/api/sentiment": PRICE },
        subscriber,
      },
      async () => NextResponse.json({ signal: "bullish" }),
    ),
  };
}

async function call(handler: ReturnType<typeof buildHandler>["handler"], headers: Record<string, string> = {}): Promise<Response> {
  const request = new Request(ROUTE, { headers });
  return handler(request as unknown as NextRequest);
}

describe("withPx402 (next app router)", () => {
  it("returns 402 on unauthenticated first hit", async () => {
    const { handler } = buildHandler();
    const res = await call(handler);
    expect(res.status).toBe(402);
    expect(res.headers.get("x-payment-amount")).toBe(PRICE);
    expect(res.headers.get("x-payment-id")).toMatch(/^\d+$/);
  });

  it("returns 200 after verified payment and sets X-Payment-Signature", async () => {
    const { handler, subscriber } = buildHandler();
    const r402 = await call(handler);
    const paymentId = r402.headers.get("x-payment-id")!;
    const token = r402.headers.get("x-payment-token")!;

    subscriber.index.set(paymentId, {
      signature: "sigXYZ",
      sender: "agent",
      receiver: PAYMENT_ADDRESS,
      amount: PRICE,
    });

    const res = await call(handler, { "x-payment-id": paymentId, "x-payment-token": token });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-payment-signature")).toBe("sigXYZ");
    expect(await res.json()).toMatchObject({ signal: "bullish" });
  });

  it("returns 402 payment_pending when the tick has not been seen yet", async () => {
    const { handler } = buildHandler();
    const r402 = await call(handler);
    const res = await call(handler, {
      "x-payment-id": r402.headers.get("x-payment-id")!,
      "x-payment-token": r402.headers.get("x-payment-token")!,
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("payment_pending");
  });

  it("returns 401 on a tampered token", async () => {
    const { handler } = buildHandler();
    const r402 = await call(handler);
    const paymentId = r402.headers.get("x-payment-id")!;
    const parts = r402.headers.get("x-payment-token")!.split(".");
    parts[2] = "A" + parts[2]!.slice(1);

    const res = await call(handler, {
      "x-payment-id": paymentId,
      "x-payment-token": parts.join("."),
    });
    expect(res.status).toBe(401);
  });
});
