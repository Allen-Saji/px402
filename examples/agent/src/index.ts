/**
 * Devnet agent example.
 *
 * Exercises the full px402 flow against a running demo-apis server:
 *   1. Load keypair.
 *   2. Print base-chain USDC balance.
 *   3. Call /api/sentiment via client.fetch. The client handles 402 -> pay ->
 *      retry automatically. Payment route is private base->base.
 *
 * No pre-deposit is needed: every payment pulls from the agent's base-chain
 * ATA and settles into the server's base-chain ATA via the TEE.
 *
 * Env:
 *   AGENT_KEYPAIR_PATH    defaults to ~/.config/solana/id.json
 *   PX402_MINT            defaults to the devnet USDC mint
 *   PX402_SERVER_URL      demo-apis base URL (default http://localhost:8787)
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Px402Client } from "@px402/client";
import { Keypair } from "@solana/web3.js";

const DEFAULT_KEYPAIR_PATH = join(homedir(), ".config/solana/id.json");
const DEFAULT_MINT = "5CmxDcDtDiqwxy9TDVyo1Xjr4AFwQzrH7vKr8cXfkEse";
const DEFAULT_SERVER_URL = "http://localhost:8787";

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const keypairPath = process.env.AGENT_KEYPAIR_PATH ?? DEFAULT_KEYPAIR_PATH;
  const mint = process.env.PX402_MINT ?? DEFAULT_MINT;
  const serverUrl = process.env.PX402_SERVER_URL ?? DEFAULT_SERVER_URL;

  const wallet = loadKeypair(keypairPath);
  console.log(`[agent] wallet=${wallet.publicKey.toBase58()}`);
  console.log(`[agent] mint=${mint}`);
  console.log(`[agent] server=${serverUrl}`);

  const client = new Px402Client({
    wallet,
    mint,
    ...(process.env.PX402_API_URL ? { apiUrl: process.env.PX402_API_URL } : {}),
    ...(process.env.PX402_BASE_RPC_URL ? { baseRpcUrl: process.env.PX402_BASE_RPC_URL } : {}),
    ...(process.env.PX402_EPHEMERAL_RPC_URL
      ? { ephemeralRpcUrl: process.env.PX402_EPHEMERAL_RPC_URL }
      : {}),
  });

  try {
    const base = await client.balance();
    console.log(`[agent] base balance  :`, base);
  } catch (e) {
    console.log(`[agent] base balance ERROR:`, (e as Error).message);
  }

  console.log("[agent] calling /api/sentiment via px402 client");
  const t0 = Date.now();
  const res = await client.fetch(
    `${serverUrl}/api/sentiment?token=SOL`,
    {},
    {
      onBeforePay: (h) =>
        console.log(`[agent] 402 received. paymentId=${h.paymentId} amount=${h.amount}`),
      onAfterPay: (e) => console.log(`[agent] transfer sig=${e.signature}`),
      onRetry: (attempt, delay, reason) =>
        console.log(`[agent] retry #${attempt} after ${delay}ms (${reason})`),
    },
  );
  console.log(`[agent] ${res.status} in ${Date.now() - t0}ms`);
  if (res.status !== 200) {
    console.error(await res.text());
    process.exit(1);
  }
  console.log("[agent] response:", await res.json());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
