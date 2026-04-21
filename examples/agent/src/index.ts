/**
 * Phase 2 devnet agent.
 *
 * Exercises the full px402 flow against a live MagicBlock PER:
 *   1. Load agent keypair from AGENT_KEYPAIR_PATH (default ~/.config/solana/id.json).
 *   2. Print base and PER balances.
 *   3. If PER balance below threshold, deposit via client.deposit().
 *   4. Hit the demo-apis /api/sentiment endpoint via client.fetch.
 *   5. Print the verified response.
 *
 * Env vars:
 *   AGENT_KEYPAIR_PATH       defaults to ~/.config/solana/id.json
 *   PX402_MINT               defaults to the devnet USDC mint bootstrapped for px402
 *   PX402_SERVER_URL         URL of a running demo-apis server (default http://localhost:8787)
 *   PX402_MIN_PER_BALANCE    auto-deposit target if PER balance falls below, in micro-USDC
 *   PX402_DEPOSIT_AMOUNT     how much to deposit when topping up, in micro-USDC
 *   PX402_API_URL, PX402_BASE_RPC_URL, PX402_EPHEMERAL_RPC_URL  optional overrides
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
  const minPerBalance = BigInt(process.env.PX402_MIN_PER_BALANCE ?? "100000"); // 0.1
  const depositAmount = BigInt(process.env.PX402_DEPOSIT_AMOUNT ?? "1000000"); // 1.0

  const wallet = loadKeypair(keypairPath);
  console.log(`[agent] wallet=${wallet.publicKey.toBase58()}`);
  console.log(`[agent] mint=${mint}`);
  console.log(`[agent] server=${serverUrl}`);

  const visibility = (process.env.PX402_VISIBILITY as "private" | "public" | undefined) ?? "private";
  const fromBalance = (process.env.PX402_FROM_BALANCE as "base" | "ephemeral" | undefined) ?? "ephemeral";
  const toBalance = (process.env.PX402_TO_BALANCE as "base" | "ephemeral" | undefined) ?? "ephemeral";
  const client = new Px402Client({
    wallet,
    mint,
    visibility,
    fromBalance,
    toBalance,
    ...(process.env.PX402_API_URL ? { apiUrl: process.env.PX402_API_URL } : {}),
    ...(process.env.PX402_BASE_RPC_URL
      ? { baseRpcUrl: process.env.PX402_BASE_RPC_URL }
      : {}),
    ...(process.env.PX402_EPHEMERAL_RPC_URL
      ? { ephemeralRpcUrl: process.env.PX402_EPHEMERAL_RPC_URL }
      : {}),
  });
  console.log(`[agent] visibility=${visibility} fromBalance=${fromBalance} toBalance=${toBalance}`);

  const [base, priv] = await Promise.all([
    client.balance().catch((e) => ({ error: e.message })),
    client.privateBalance().catch((e) => ({ error: e.message })),
  ]);
  console.log(`[agent] base balance   :`, base);
  console.log(`[agent] PER balance    :`, priv);

  const currentPer =
    "amount" in priv ? BigInt(priv.amount) : 0n;

  if (currentPer < minPerBalance) {
    console.log(
      `[agent] PER balance ${currentPer} < ${minPerBalance}, depositing ${depositAmount}`,
    );
    const sig = await client.deposit(depositAmount);
    console.log(`[agent] deposit sig=${sig}`);
    // NOTE: post-deposit balance read is gated by the auth challenge on
    // /v1/spl/private-balance. Skip until that flow is integrated.
  }

  console.log("[agent] calling /api/sentiment via px402 client");
  const t0 = Date.now();
  const res = await client.fetch(
    `${serverUrl}/api/sentiment?token=SOL`,
    {},
    {
      onBeforePay: (h) =>
        console.log(`[agent] 402 received. paymentId=${h.paymentId} amount=${h.amount}`),
      onAfterPay: (e) =>
        console.log(`[agent] transfer sig=${e.signature}`),
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
