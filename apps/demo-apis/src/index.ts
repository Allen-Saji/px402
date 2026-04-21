/**
 * px402 demo APIs server.
 *
 * Wires up @px402/hono with a PrivateTransferSubscriber that listens on the
 * MagicBlock ER queue PDA. Also keeps the crank warm by pinging
 * /v1/spl/is-mint-initialized at startup and on an interval.
 */
import { serve } from "@hono/node-server";
import { PrivateTransferSubscriber, deriveQueuePda } from "@px402/core";
import { px402 } from "@px402/hono";
import { Hono } from "hono";
import { loadConfig } from "./config.js";

const VALIDATOR_DEVNET = "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57";
const CRANK_KICKSTART_INTERVAL_MS = 30_000;

async function kickstartCrank(apiUrl: string, mint: string, cluster: string): Promise<void> {
  const url = new URL(`${apiUrl}/v1/spl/is-mint-initialized`);
  url.searchParams.set("mint", mint);
  url.searchParams.set("cluster", cluster);
  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn(`[px402] crank kickstart HTTP ${res.status}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[px402] crank kickstart failed: ${msg}`);
  }
}

async function main() {
  const cfg = loadConfig();
  const queuePda = deriveQueuePda(cfg.mint, cfg.validator ?? VALIDATOR_DEVNET);

  console.log("[px402 demo-apis] config:");
  console.log(`  api base RPC       : ${cfg.baseRpcUrl}`);
  console.log(`  ephemeral RPC      : ${cfg.ephemeralRpcUrl}`);
  console.log(`  ephemeral WS       : ${cfg.ephemeralWsUrl}`);
  console.log(`  payments API       : ${cfg.apiUrl}`);
  console.log(`  payment address    : ${cfg.paymentAddress} (server wallet)`);
  console.log(`  mint               : ${cfg.mint}`);
  console.log(`  queue PDA          : ${queuePda.toBase58()}`);

  // Prime the crank so queued transfers actually execute.
  await kickstartCrank(cfg.apiUrl, cfg.mint, cfg.cluster);
  const crankTimer = setInterval(
    () => void kickstartCrank(cfg.apiUrl, cfg.mint, cfg.cluster),
    CRANK_KICKSTART_INTERVAL_MS,
  );

  const subscriber = new PrivateTransferSubscriber({
    rpcUrl: cfg.ephemeralRpcUrl,
    queuePda: queuePda.toBase58(),
    receiverWallet: cfg.paymentAddress,
    commitment: "finalized",
    logger: {
      info: (m) => console.log(m),
      warn: (m) => console.warn(m),
      error: (m) => console.error(m),
    },
  });

  subscriber.on("tick", (e) => {
    console.log(
      `[px402] tick clientRefId=${e.clientRefId} sender=${e.sender} amount=${e.amount} sig=${e.signature}`,
    );
  });

  await subscriber.start();
  console.log("[px402 demo-apis] subscribed to queue PDA");

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
      paymentAddress: cfg.paymentAddress,
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
      confidence: 0.82 + hashToUnit(token) * 0.17,
      lastUpdated: new Date().toISOString(),
    });
  });

  const server = serve({ fetch: app.fetch, port: cfg.port }, (info) => {
    console.log(`[px402 demo-apis] listening on http://localhost:${info.port}`);
  });

  const shutdown = () => {
    console.log("[px402 demo-apis] shutting down");
    clearInterval(crankTimer);
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
