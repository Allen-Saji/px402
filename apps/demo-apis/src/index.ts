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

  app.get("/api/whales", (c) => {
    const min = Number(c.req.query("min") ?? 100_000);
    const seed = hashToUnit(`whales:${min}`);
    const count = 2 + Math.floor(seed * 4);
    const transfers = Array.from({ length: count }, (_, i) => ({
      from: syntheticAddress(`w-from-${min}-${i}`),
      to: syntheticAddress(`w-to-${min}-${i}`),
      token: pickToken(seed + i * 0.1),
      amount: Math.floor(min * (1.0 + hashToUnit(`amt-${min}-${i}`) * 9)),
      slot: 337_000_000 + Math.floor(hashToUnit(`slot-${min}-${i}`) * 500_000),
    }));
    return c.json({
      minAmount: min,
      window: "24h",
      transfers,
      lastUpdated: new Date().toISOString(),
    });
  });

  app.get("/api/risk", (c) => {
    const address = c.req.query("address");
    if (!address) return c.json({ error: "address query param required" }, 400);
    const risk = hashToUnit(`risk:${address}`);
    const signals: string[] = [];
    if (hashToUnit(`mev:${address}`) > 0.8) signals.push("frequent-mev-sandwich-target");
    if (hashToUnit(`sanct:${address}`) > 0.92) signals.push("sanctioned-cex-proximity");
    if (hashToUnit(`rug:${address}`) > 0.87) signals.push("interacted-with-known-rug");
    return c.json({
      address,
      risk: Number(risk.toFixed(3)),
      band: riskBand(risk),
      signals,
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

const WHALE_TOKEN_MIX = ["SOL", "USDC", "JUP", "BONK", "JTO", "PYTH"] as const;

function pickToken(u: number): string {
  const idx = Math.floor(((u % 1) + 1) % 1 * WHALE_TOKEN_MIX.length);
  return WHALE_TOKEN_MIX[idx] ?? "SOL";
}

function riskBand(u: number): "low" | "medium" | "high" {
  if (u < 0.33) return "low";
  if (u < 0.75) return "medium";
  return "high";
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function syntheticAddress(seed: string): string {
  let u = hashToUnit(seed);
  let out = "";
  for (let i = 0; i < 44; i++) {
    u = (u * 9301 + 49297) % 233280;
    out += BASE58[Math.floor((u / 233280) * BASE58.length)];
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
