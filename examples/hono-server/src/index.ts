/**
 * Example px402-gated Hono server.
 *
 * Phase 1 uses an in-memory "FakeSubscriber" that the round-trip client pokes
 * directly to simulate a PER transfer landing on-chain. Phase 2 replaces this
 * with a real PerSubscriber pointed at the MagicBlock ER WebSocket.
 */
import { serve } from "@hono/node-server";
import type { VerifiedMemoPayment } from "@px402/core";
import { type SubscriberLike, px402 } from "@px402/hono";
import { Hono } from "hono";

const PORT = Number(process.env.PORT ?? 8787);
const SERVER_SECRET =
  process.env.PX402_SERVER_SECRET ?? "dev-secret-do-not-use-in-production";
const DESTINATION =
  process.env.PX402_DESTINATION ?? "3PkQ4JM6WWWEpxoaQtFczYgn47ZkMmdFWySSBfGVVh6v";

class FakeSubscriber implements SubscriberLike {
  private memos = new Map<string, VerifiedMemoPayment>();
  private used = new Set<string>();

  inject(memo: string, payment: VerifiedMemoPayment): void {
    this.memos.set(memo, payment);
  }

  lookupByMemo(memo: string): VerifiedMemoPayment | undefined {
    return this.memos.get(memo);
  }

  markSignatureUsed(signature: string): boolean {
    if (this.used.has(signature)) return false;
    this.used.add(signature);
    return true;
  }
}

const subscriber = new FakeSubscriber();

const app = new Hono();

app.use(
  "*",
  px402({
    serverSecret: SERVER_SECRET,
    destination: DESTINATION,
    pricing: {
      "/api/sentiment": "10000", // 0.01 USDC (micro)
      "/api/whales": "20000",
      "/api/risk": "30000",
    },
    subscriber,
    onVerified: (e) =>
      console.log(
        `[px402] verified path=${e.path} sig=${e.signature} amount=${e.amount}`,
      ),
  }),
);

app.get("/", (c) =>
  c.json({
    service: "px402 example",
    endpoints: ["/api/sentiment", "/api/whales", "/api/risk"],
  }),
);

app.get("/api/sentiment", (c) =>
  c.json({
    token: c.req.query("token") ?? "SOL",
    sentiment: "bullish",
    confidence: 0.92,
  }),
);

app.get("/api/whales", (c) =>
  c.json({
    min: Number(c.req.query("min") ?? 100000),
    transfers: [
      { from: "4xH...A1", to: "7zP...B3", amount: 250_000 },
      { from: "9nM...C2", to: "2kL...D9", amount: 180_000 },
    ],
  }),
);

app.get("/api/risk", (c) =>
  c.json({ address: c.req.query("address") ?? "unknown", risk: 0.12 }),
);

// Dev-only endpoint: simulates the PerSubscriber seeing a memo on-chain.
// Production servers never expose this.
if (process.env.NODE_ENV !== "production") {
  app.post("/__dev/memo", async (c) => {
    const body = (await c.req.json()) as {
      memo?: string;
      signature?: string;
      amount?: string;
    };
    if (!body.memo || !body.signature || !body.amount) {
      return c.json({ error: "missing fields" }, 400);
    }
    subscriber.inject(body.memo, {
      signature: body.signature,
      amount: body.amount,
    });
    return c.json({ ok: true });
  });
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[px402 example] listening on http://localhost:${info.port}`);
});
