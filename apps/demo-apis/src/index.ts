/**
 * px402 demo APIs server.
 *
 * Wires up @px402/hono with a real PerSubscriber pointed at MagicBlock ER.
 * First endpoint: /api/sentiment. Whales and risk come in Lane A of Phase 3.
 */
import { serve } from "@hono/node-server";
import { PerSubscriber, createFetchAmount } from "@px402/core";
import { px402 } from "@px402/hono";
import { Hono } from "hono";
import { loadConfig } from "./config.js";

async function main() {
  const cfg = loadConfig();
  console.log("[px402 demo-apis] config:");
  console.log(`  api base RPC       : ${cfg.baseRpcUrl}`);
  console.log(`  ephemeral RPC      : ${cfg.ephemeralRpcUrl}`);
  console.log(`  ephemeral WS       : ${cfg.ephemeralWsUrl}`);
  console.log(`  destination ATA    : ${cfg.destinationAta}`);
  console.log(`  destination wallet : ${cfg.destinationWallet}`);
  console.log(`  mint               : ${cfg.mint}`);

  const fetchAmount = createFetchAmount({
    rpcUrl: cfg.ephemeralRpcUrl,
    destinationOwner: cfg.destinationWallet,
    mint: cfg.mint,
    commitment: "finalized",
  });

  const subscriber = new PerSubscriber({
    wsUrl: cfg.ephemeralWsUrl,
    destination: cfg.destinationAta,
    fetchAmount,
    commitment: "finalized",
    logger: {
      info: (m) => console.log(m),
      warn: (m) => console.warn(m),
      error: (m) => console.error(m),
    },
  });

  subscriber.on("memo", (e) => {
    console.log(
      `[px402] memo seen memo=${e.memo} sig=${e.signature} amount=${e.amount}`,
    );
  });

  await subscriber.start();
  console.log("[px402 demo-apis] logsSubscribe connected");

  const app = new Hono();

  app.get("/", (c) =>
    c.json({
      service: "px402-demo-apis",
      endpoints: Object.keys(cfg.pricing),
    }),
  );

  app.use(
    "*",
    px402({
      serverSecret: cfg.serverSecret,
      destination: cfg.destinationAta,
      pricing: cfg.pricing,
      subscriber,
      onVerified: (e) =>
        console.log(
          `[px402] verified path=${e.path} sig=${e.signature} amount=${e.amount} ip=${e.ip}`,
        ),
    }),
  );

  app.get("/api/sentiment", (c) => {
    const token = c.req.query("token") ?? "SOL";
    return c.json({
      token: token.toUpperCase(),
      sentiment: deterministicSentiment(token),
      confidence: 0.82 + (hashToUnit(token) * 0.17),
      lastUpdated: new Date().toISOString(),
    });
  });

  const server = serve(
    { fetch: app.fetch, port: cfg.port },
    (info) => {
      console.log(`[px402 demo-apis] listening on http://localhost:${info.port}`);
    },
  );

  const shutdown = () => {
    console.log("[px402 demo-apis] shutting down");
    subscriber.stop();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function hashToUnit(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0) / 0xffffffff;
}

function deterministicSentiment(token: string): "bullish" | "bearish" | "neutral" {
  const u = hashToUnit(token);
  if (u < 0.45) return "bullish";
  if (u < 0.75) return "bearish";
  return "neutral";
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
