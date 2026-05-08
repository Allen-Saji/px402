/**
 * Minimal Express server gated by @px402/express. Used for smoke-testing the
 * adapter end-to-end against MagicBlock devnet via @px402/client.
 *
 * Reuses the same env shape as apps/demo-apis to keep wiring consistent.
 */
import express from "express";
import { px402 } from "@px402/express";
import { PrivateTransferSubscriber, deriveQueuePda } from "@px402/core";

const VALIDATOR_DEVNET = "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env var: ${name}`);
  return v;
}

async function main() {
  const port = Number(process.env.PORT ?? 8902);
  const paymentAddress = required("PX402_PAYMENT_ADDRESS");
  const mint = required("PX402_MINT");
  const ephemeralRpcUrl = process.env.PX402_EPHEMERAL_RPC_URL ?? "https://devnet.magicblock.app";
  const apiUrl = process.env.PX402_API_URL ?? "https://payments.magicblock.app";
  const cluster = process.env.PX402_CLUSTER ?? "devnet";
  const validator = process.env.PX402_VALIDATOR ?? VALIDATOR_DEVNET;
  const serverSecret = required("PX402_SERVER_SECRET");

  const queuePda = deriveQueuePda(mint, validator).toBase58();
  console.log(`[px402-express] queue PDA: ${queuePda}`);
  console.log(`[px402-express] payment address: ${paymentAddress}`);

  // Crank kickstart so queued transfers actually execute on MagicBlock devnet.
  await fetch(`${apiUrl}/v1/spl/is-mint-initialized?mint=${mint}&cluster=${cluster}`).catch(() => {});

  const subscriber = new PrivateTransferSubscriber({
    rpcUrl: ephemeralRpcUrl,
    queuePda,
    receiverWallet: paymentAddress,
    commitment: "finalized",
  });
  await subscriber.start();
  console.log("[px402-express] subscribed to queue PDA");

  const app = express();

  app.use(
    px402({
      serverSecret,
      paymentAddress,
      pricing: { "/api/sentiment": "10000" },
      subscriber,
    }),
  );

  app.get("/api/sentiment", (req, res) => {
    const token = String(req.query.token ?? "SOL");
    res.json({ token, sentiment: "bullish", source: "express" });
  });

  app.get("/", (_req, res) => {
    res.json({ service: "px402-example-server-express", endpoints: ["/api/sentiment"] });
  });

  app.listen(port, "127.0.0.1", () => {
    console.log(`[px402-express] listening on http://127.0.0.1:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
