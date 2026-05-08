import { NextResponse, type NextRequest } from "next/server";
import { withPx402 } from "@px402/next";
import { PrivateTransferSubscriber, deriveQueuePda } from "@px402/core";

const VALIDATOR_DEVNET = "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env var: ${name}`);
  return v;
}

const PAYMENT_ADDRESS = required("PX402_PAYMENT_ADDRESS");
const MINT = required("PX402_MINT");
const SERVER_SECRET = required("PX402_SERVER_SECRET");
const EPHEMERAL_RPC = process.env.PX402_EPHEMERAL_RPC_URL ?? "https://devnet.magicblock.app";
const VALIDATOR = process.env.PX402_VALIDATOR ?? VALIDATOR_DEVNET;

// Hoist on globalThis so dev hot reloads don't spawn duplicate pollers.
const g = globalThis as unknown as { __px402Subscriber?: PrivateTransferSubscriber };
if (!g.__px402Subscriber) {
  const queuePda = deriveQueuePda(MINT, VALIDATOR).toBase58();
  console.log(`[px402-next] queue PDA: ${queuePda}`);
  const sub = new PrivateTransferSubscriber({
    rpcUrl: EPHEMERAL_RPC,
    queuePda,
    receiverWallet: PAYMENT_ADDRESS,
    commitment: "finalized",
  });
  void sub.start();
  g.__px402Subscriber = sub;
}

export const dynamic = "force-dynamic";

export const GET = withPx402(
  {
    serverSecret: SERVER_SECRET,
    paymentAddress: PAYMENT_ADDRESS,
    pricing: { "/api/sentiment": "10000" },
    subscriber: g.__px402Subscriber!,
  },
  async (req: NextRequest) => {
    const token = new URL(req.url).searchParams.get("token") ?? "SOL";
    return NextResponse.json({ token, sentiment: "bullish", source: "next" });
  },
);
