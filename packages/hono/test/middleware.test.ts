import type { VerifiedTickRecord } from "@px402/core";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { px402 } from "../src/middleware.js";
import type { SubscriberLike } from "../src/types.js";

const PAYMENT_ADDRESS = "8AxCJeRrtfwNVQ5huVoF9cto7Y4Jvw6bP1TUUs2ZnK56";
const PRICE = "10000"; // 0.01 USDC micro-units

class FakeSubscriber implements SubscriberLike {
  public index = new Map<string, VerifiedTickRecord>();
  public usedSignatures = new Set<string>();

  lookupByClientRefId(clientRefId: string): VerifiedTickRecord | undefined {
    return this.index.get(clientRefId);
  }

  markSignatureUsed(signature: string): boolean {
    if (this.usedSignatures.has(signature)) return false;
    this.usedSignatures.add(signature);
    return true;
  }
}

function buildApp(overrides: Partial<Parameters<typeof px402>[0]> = {}) {
  const subscriber = new FakeSubscriber();
  const app = new Hono();
  app.use(
    "*",
    px402({
      serverSecret: "test-secret",
      paymentAddress: PAYMENT_ADDRESS,
      pricing: { "/api/sentiment": PRICE },
      subscriber,
      ...overrides,
    }),
  );
  app.get("/api/sentiment", (c) => c.json({ signal: "bullish", confidence: 0.92 }));
  app.get("/api/free", (c) => c.json({ ok: true }));
  return { app, subscriber };
}

describe("px402 hono middleware", () => {
  it("serves free endpoints without payment", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/free");
    expect(res.status).toBe(200);
  });

  it("returns 402 with all payment headers on first hit", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/sentiment");
    expect(res.status).toBe(402);
    expect(res.headers.get("X-Payment-Amount")).toBe(PRICE);
    expect(res.headers.get("X-Payment-Currency")).toBe("USDC");
    expect(res.headers.get("X-Payment-Network")).toBe("solana-per");
    expect(res.headers.get("X-Payment-Address")).toBe(PAYMENT_ADDRESS);
    expect(res.headers.get("X-Payment-Id")).toMatch(/^\d+$/);
    expect(res.headers.get("X-Payment-Token")?.split(".")).toHaveLength(3);
  });

  it("returns 200 after memo is seen", async () => {
    const { app, subscriber } = buildApp();
    const res1 = await app.request("/api/sentiment");
    const paymentId = res1.headers.get("X-Payment-Id")!;
    const token = res1.headers.get("X-Payment-Token")!;

    subscriber.index.set(paymentId, {
      signature: "sigXYZ",
      sender: "agent",
      receiver: PAYMENT_ADDRESS,
      amount: PRICE,
    });

    const res2 = await app.request("/api/sentiment", {
      headers: {
        "X-Payment-Id": paymentId,
        "X-Payment-Token": token,
      },
    });
    expect(res2.status).toBe(200);
    expect(res2.headers.get("X-Payment-Signature")).toBe("sigXYZ");
    const body = (await res2.json()) as Record<string, unknown>;
    expect(body).toEqual({ signal: "bullish", confidence: 0.92 });
  });

  it("returns 402 pending when memo not yet indexed", async () => {
    const { app } = buildApp();
    const res1 = await app.request("/api/sentiment");
    const paymentId = res1.headers.get("X-Payment-Id")!;
    const token = res1.headers.get("X-Payment-Token")!;

    const res2 = await app.request("/api/sentiment", {
      headers: { "X-Payment-Id": paymentId, "X-Payment-Token": token },
    });
    expect(res2.status).toBe(402);
    const body = (await res2.json()) as Record<string, unknown>;
    expect(body.error).toBe("payment_pending");
  });

  it("returns 402 amount_mismatch when memo amount is wrong", async () => {
    const { app, subscriber } = buildApp();
    const res1 = await app.request("/api/sentiment");
    const paymentId = res1.headers.get("X-Payment-Id")!;
    const token = res1.headers.get("X-Payment-Token")!;

    subscriber.index.set(paymentId, {
      signature: "sigABC",
      sender: "agent",
      receiver: PAYMENT_ADDRESS,
      amount: "5000",
    });

    const res2 = await app.request("/api/sentiment", {
      headers: { "X-Payment-Id": paymentId, "X-Payment-Token": token },
    });
    expect(res2.status).toBe(402);
    const body = (await res2.json()) as Record<string, unknown>;
    expect(body.error).toBe("amount_mismatch");
    expect(body.expected).toBe(PRICE);
    expect(body.actual).toBe("5000");
  });

  it("returns 409 on replay of the same signature", async () => {
    const { app, subscriber } = buildApp();

    const res1 = await app.request("/api/sentiment");
    const paymentId1 = res1.headers.get("X-Payment-Id")!;
    const token1 = res1.headers.get("X-Payment-Token")!;
    subscriber.index.set(paymentId1, {
      signature: "sameSig",
      sender: "agent",
      receiver: PAYMENT_ADDRESS,
      amount: PRICE,
    });
    const ok = await app.request("/api/sentiment", {
      headers: { "X-Payment-Id": paymentId1, "X-Payment-Token": token1 },
    });
    expect(ok.status).toBe(200);

    // Second payment reuses the same signature (attacker tries to double-spend).
    const res2 = await app.request("/api/sentiment");
    const paymentId2 = res2.headers.get("X-Payment-Id")!;
    const token2 = res2.headers.get("X-Payment-Token")!;
    subscriber.index.set(paymentId2, {
      signature: "sameSig",
      sender: "agent",
      receiver: PAYMENT_ADDRESS,
      amount: PRICE,
    });
    const replay = await app.request("/api/sentiment", {
      headers: { "X-Payment-Id": paymentId2, "X-Payment-Token": token2 },
    });
    expect(replay.status).toBe(409);
  });

  it("returns 401 when paymentId header does not match token payload", async () => {
    const { app } = buildApp();
    const res1 = await app.request("/api/sentiment");
    const token = res1.headers.get("X-Payment-Token")!;

    const res2 = await app.request("/api/sentiment", {
      headers: { "X-Payment-Id": "tampered-id", "X-Payment-Token": token },
    });
    expect(res2.status).toBe(401);
    const body = (await res2.json()) as Record<string, unknown>;
    expect(body.error).toBe("payment_id_mismatch");
  });

  it("returns 401 on tampered token", async () => {
    const { app } = buildApp();
    const res1 = await app.request("/api/sentiment");
    const paymentId = res1.headers.get("X-Payment-Id")!;
    const token = res1.headers.get("X-Payment-Token")!;
    const parts = token.split(".");
    const tampered = parts.map((p, i) => (i === 2 ? "A" + p.slice(1) : p)).join(".");

    const res2 = await app.request("/api/sentiment", {
      headers: { "X-Payment-Id": paymentId, "X-Payment-Token": tampered },
    });
    expect(res2.status).toBe(401);
  });

  it("returns fresh 402 when token is expired", async () => {
    const { app, subscriber } = buildApp({ tokenTtlMs: 1 });
    const res1 = await app.request("/api/sentiment");
    const paymentId = res1.headers.get("X-Payment-Id")!;
    const token = res1.headers.get("X-Payment-Token")!;

    await new Promise((r) => setTimeout(r, 5));
    subscriber.index.set(paymentId, {
      signature: "late",
      sender: "agent",
      receiver: PAYMENT_ADDRESS,
      amount: PRICE,
    });

    const res2 = await app.request("/api/sentiment", {
      headers: { "X-Payment-Id": paymentId, "X-Payment-Token": token },
    });
    expect(res2.status).toBe(402);
    const body = (await res2.json()) as Record<string, unknown>;
    expect(body.reason).toBe("expired");
    expect(res2.headers.get("X-Payment-Id")).toMatch(/^\d+$/);
    expect(res2.headers.get("X-Payment-Id")).not.toBe(paymentId);
  });

  it("fires onVerified callback on successful payment", async () => {
    const events: Array<Record<string, unknown>> = [];
    const { app, subscriber } = buildApp({
      onVerified: (e) => events.push({ ...e }),
    });
    const res1 = await app.request("/api/sentiment");
    const paymentId = res1.headers.get("X-Payment-Id")!;
    const token = res1.headers.get("X-Payment-Token")!;
    subscriber.index.set(paymentId, {
      signature: "sigZ",
      sender: "agent",
      receiver: PAYMENT_ADDRESS,
      amount: PRICE,
    });
    await app.request("/api/sentiment", {
      headers: { "X-Payment-Id": paymentId, "X-Payment-Token": token },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.signature).toBe("sigZ");
    expect(events[0]!.amount).toBe(PRICE);
    expect(events[0]!.path).toBe("/api/sentiment");
  });

  it("concurrent payments both verify (critical regression)", async () => {
    const { app, subscriber } = buildApp();

    const [resA1, resB1] = await Promise.all([
      app.request("/api/sentiment"),
      app.request("/api/sentiment"),
    ]);
    const idA = resA1.headers.get("X-Payment-Id")!;
    const tokA = resA1.headers.get("X-Payment-Token")!;
    const idB = resB1.headers.get("X-Payment-Id")!;
    const tokB = resB1.headers.get("X-Payment-Token")!;
    expect(idA).not.toBe(idB);

    subscriber.index.set(idA, {
      signature: "sigA",
      sender: "agent",
      receiver: PAYMENT_ADDRESS,
      amount: PRICE,
    });
    subscriber.index.set(idB, {
      signature: "sigB",
      sender: "agent",
      receiver: PAYMENT_ADDRESS,
      amount: PRICE,
    });

    const [okA, okB] = await Promise.all([
      app.request("/api/sentiment", {
        headers: { "X-Payment-Id": idA, "X-Payment-Token": tokA },
      }),
      app.request("/api/sentiment", {
        headers: { "X-Payment-Id": idB, "X-Payment-Token": tokB },
      }),
    ]);
    expect(okA.status).toBe(200);
    expect(okB.status).toBe(200);
  });

  it("returns 429 when IP rate limit exceeded", async () => {
    const { app } = buildApp({
      rateLimit: { issuePerIpPerMinute: 2, windowMs: 60_000 },
    });
    const headers = { "x-forwarded-for": "1.1.1.1" };
    expect((await app.request("/api/sentiment", { headers })).status).toBe(402);
    expect((await app.request("/api/sentiment", { headers })).status).toBe(402);
    const res = await app.request("/api/sentiment", { headers });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});
