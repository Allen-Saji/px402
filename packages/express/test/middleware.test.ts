import type { VerifiedTickRecord } from "@px402/core";
import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { px402 } from "../src/middleware.js";

const PAYMENT_ADDRESS = "8AxCJeRrtfwNVQ5huVoF9cto7Y4Jvw6bP1TUUs2ZnK56";
const PRICE = "10000";

class FakeSubscriber {
  public index = new Map<string, VerifiedTickRecord>();
  public used = new Set<string>();

  lookupByClientRefId(id: string) {
    return this.index.get(id);
  }

  markSignatureUsed(sig: string) {
    if (this.used.has(sig)) return false;
    this.used.add(sig);
    return true;
  }
}

interface Harness {
  baseUrl: string;
  subscriber: FakeSubscriber;
  close: () => Promise<void>;
}

async function startServer(): Promise<Harness> {
  const subscriber = new FakeSubscriber();
  const app = express();
  app.use(
    px402({
      serverSecret: "test-secret",
      paymentAddress: PAYMENT_ADDRESS,
      pricing: { "/api/sentiment": PRICE },
      subscriber,
    }),
  );
  app.get("/api/sentiment", (_req, res) => res.json({ signal: "bullish", confidence: 0.92 }));
  app.get("/api/free", (_req, res) => res.json({ ok: true }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    subscriber,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("px402 express middleware", () => {
  let harness: Harness;
  beforeAll(async () => {
    harness = await startServer();
  });
  afterAll(async () => {
    await harness.close();
  });

  it("serves free endpoints without payment", async () => {
    const res = await fetch(`${harness.baseUrl}/api/free`);
    expect(res.status).toBe(200);
  });

  it("returns 402 with signed token on first hit", async () => {
    const res = await fetch(`${harness.baseUrl}/api/sentiment`);
    expect(res.status).toBe(402);
    expect(res.headers.get("x-payment-amount")).toBe(PRICE);
    expect(res.headers.get("x-payment-address")).toBe(PAYMENT_ADDRESS);
    expect(res.headers.get("x-payment-id")).toMatch(/^\d+$/);
    expect(res.headers.get("x-payment-token")?.split(".")).toHaveLength(3);
  });

  it("accepts a valid payment and returns 200", async () => {
    const r402 = await fetch(`${harness.baseUrl}/api/sentiment`);
    const paymentId = r402.headers.get("x-payment-id")!;
    const token = r402.headers.get("x-payment-token")!;

    harness.subscriber.index.set(paymentId, {
      signature: "sigA",
      sender: "agent",
      receiver: PAYMENT_ADDRESS,
      amount: PRICE,
    });

    const res = await fetch(`${harness.baseUrl}/api/sentiment`, {
      headers: { "X-Payment-Id": paymentId, "X-Payment-Token": token },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-payment-signature")).toBe("sigA");
    expect(await res.json()).toMatchObject({ signal: "bullish" });
  });

  it("returns 402 payment_pending when tick has not fired", async () => {
    const r402 = await fetch(`${harness.baseUrl}/api/sentiment`);
    const paymentId = r402.headers.get("x-payment-id")!;
    const token = r402.headers.get("x-payment-token")!;

    const res = await fetch(`${harness.baseUrl}/api/sentiment`, {
      headers: { "X-Payment-Id": paymentId, "X-Payment-Token": token },
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("payment_pending");
  });

  it("returns 401 on tampered token", async () => {
    const r402 = await fetch(`${harness.baseUrl}/api/sentiment`);
    const paymentId = r402.headers.get("x-payment-id")!;
    const parts = r402.headers.get("x-payment-token")!.split(".");
    parts[2] = "A" + parts[2]!.slice(1);

    const res = await fetch(`${harness.baseUrl}/api/sentiment`, {
      headers: { "X-Payment-Id": paymentId, "X-Payment-Token": parts.join(".") },
    });
    expect(res.status).toBe(401);
  });
});
