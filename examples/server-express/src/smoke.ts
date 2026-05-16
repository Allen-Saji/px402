/**
 * Smoke driver for @px402/express. Boots server.ts as a subprocess, hits the
 * gated route via @px402/client, asserts a 200 with the expected body. Exits
 * non-zero on any failure.
 *
 * Usage:
 *   pnpm --filter px402-example-server-express smoke
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Keypair } from "@solana/web3.js";
import { Px402Client } from "@px402/client";

const log = (s: string) => console.log(`[${new Date().toISOString()}] ${s}`);

function loadAgentWallet(): Keypair {
  const poolPath = join(import.meta.dirname, "..", "..", "..", "tests", "integration", ".tmp", "funded-pool.json");
  const pool = JSON.parse(readFileSync(poolPath, "utf8"));
  // Pick wallet[1] — wallet[0] gets near-rent-exempt and silently fails to land
  // in mid-runs. See feedback_smoke_wallet_funding.
  const w = pool.wallets[1];
  return Keypair.fromSecretKey(Uint8Array.from(w.secretKey));
}

function loadServerWallet(): Keypair {
  const path = join(homedir(), ".config", "solana", "px402-server.json");
  const sk = JSON.parse(readFileSync(path, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(sk));
}

function bootServer(serverPubkey: string, port: number): { child: ChildProcess; ready: Promise<void> } {
  const env = {
    ...process.env,
    PORT: String(port),
    PX402_PAYMENT_ADDRESS: serverPubkey,
    PX402_MINT: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    PX402_API_URL: "https://payments.magicblock.app",
    PX402_BASE_RPC_URL: "https://rpc.magicblock.app/devnet",
    PX402_VALIDATOR: "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57",
    PX402_CLUSTER: "devnet",
    PX402_SERVER_SECRET: `smoke_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  };
  const child = spawn("pnpm", ["start"], {
    cwd: join(import.meta.dirname, ".."),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout?.on("data", (d) => { log += d.toString(); process.stdout.write(`[server] ${d}`); });
  child.stderr?.on("data", (d) => { log += d.toString(); process.stderr.write(`[server-err] ${d}`); });

  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server boot timeout 30s")), 30000);
    const watcher = setInterval(() => {
      if (/listening on http/.test(log)) {
        clearTimeout(timer);
        clearInterval(watcher);
        resolve();
      }
      if (child.exitCode !== null) {
        clearTimeout(timer);
        clearInterval(watcher);
        reject(new Error(`server exited with ${child.exitCode} before listening`));
      }
    }, 200);
  });

  return { child, ready };
}

async function main() {
  const agent = loadAgentWallet();
  const server = loadServerWallet();
  log(`agent:  ${agent.publicKey.toBase58()}`);
  log(`server: ${server.publicKey.toBase58()}`);

  const port = 8902 + Math.floor(Math.random() * 100);
  const { child, ready } = bootServer(server.publicKey.toBase58(), port);
  try {
    await ready;
    log(`server up on :${port}, giving subscriber a 5s head start`);
    await new Promise((r) => setTimeout(r, 5000));

    const client = new Px402Client({
      wallet: agent,
      mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      apiUrl: "https://payments.magicblock.app",
      baseRpcUrl: "https://api.devnet.solana.com",
      ephemeralRpcUrl: "https://devnet.magicblock.app",
      cluster: "devnet",
      // Devnet crank cadence is ~3-5min after the 2026-05-13 protocol
      // change. Default ~30s is mainnet-shaped; smokes need a longer budget.
      retryDelaysMs: [3000, 6000, 12000, 30000, 60000, 120000, 300000],
    });

    const t0 = Date.now();
    const res = await client.fetch(
      `http://127.0.0.1:${port}/api/sentiment?token=SOL`,
      {},
      {
        onBeforePay: (h) => log(`onBeforePay paymentId=${h.paymentId} amount=${h.amount}`),
        onAfterPay: (e) => log(`onAfterPay  signature=${e.signature}`),
        onRetry: (a, d, e) => log(`onRetry attempt=${a} delay=${d}ms err=${e}`),
      },
    );
    const latencyMs = Date.now() - t0;
    const body = await res.json();
    log(`response status=${res.status} latency=${latencyMs}ms body=${JSON.stringify(body)}`);

    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    if (!body || (body as { source?: string }).source !== "express") {
      throw new Error(`unexpected body: ${JSON.stringify(body)}`);
    }
    log("PASS");
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("[smoke] FAIL:", err);
    process.exit(1);
  },
);
