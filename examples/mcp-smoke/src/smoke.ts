/**
 * Smoke harness for @px402/mcp.
 *
 * Flow:
 *   1. Boot apps/demo-apis on a free port (target for px402_fetch)
 *   2. Spawn the @px402/mcp bin via stdio with an agent keypair on disk
 *   3. Connect MCP client over stdio
 *   4. Call px402_balance — assert it returns a JSON balance
 *   5. Call px402_fetch against the demo-apis /api/sentiment route — assert 200
 *
 * Exits non-zero on any failure.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Keypair } from "@solana/web3.js";

const log = (s: string) => console.log(`[${new Date().toISOString()}] ${s}`);

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

function loadAgentWallet(): { wallet: Keypair; secretKey: number[] } {
  const poolPath = join(REPO_ROOT, "tests", "integration", ".tmp", "funded-pool.json");
  const pool = JSON.parse(readFileSync(poolPath, "utf8"));
  const w = pool.wallets[3];
  return { wallet: Keypair.fromSecretKey(Uint8Array.from(w.secretKey)), secretKey: w.secretKey };
}

function loadServerWallet(): Keypair {
  const path = join(homedir(), ".config", "solana", "px402-server.json");
  const sk = JSON.parse(readFileSync(path, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(sk));
}

function bootDemoApis(serverPubkey: string, port: number): { child: ChildProcess; ready: Promise<void> } {
  const env = {
    ...process.env,
    PORT: String(port),
    PX402_PAYMENT_ADDRESS: serverPubkey,
    PX402_MINT: "5CmxDcDtDiqwxy9TDVyo1Xjr4AFwQzrH7vKr8cXfkEse",
    PX402_API_URL: "https://payments.magicblock.app",
    PX402_BASE_RPC_URL: "https://rpc.magicblock.app/devnet",
    PX402_EPHEMERAL_RPC_URL: "https://devnet.magicblock.app",
    PX402_VALIDATOR: "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57",
    PX402_CLUSTER: "devnet",
    PX402_SERVER_SECRET: `mcp_smoke_${Date.now()}`,
  };
  const child = spawn("pnpm", ["start"], {
    cwd: join(REPO_ROOT, "apps", "demo-apis"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buf = "";
  child.stdout?.on("data", (d) => { buf += d.toString(); process.stdout.write(`[demo-apis] ${d}`); });
  child.stderr?.on("data", (d) => { buf += d.toString(); process.stderr.write(`[demo-apis-err] ${d}`); });
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("demo-apis boot timeout 30s")), 30000);
    const watcher = setInterval(() => {
      if (/listening on http/.test(buf)) {
        clearTimeout(timer);
        clearInterval(watcher);
        resolve();
      }
      if (child.exitCode !== null) {
        clearTimeout(timer);
        clearInterval(watcher);
        reject(new Error(`demo-apis exited with ${child.exitCode}`));
      }
    }, 200);
  });
  return { child, ready };
}

async function main() {
  const { secretKey } = loadAgentWallet();
  const server = loadServerWallet();
  log(`server: ${server.publicKey.toBase58()}`);

  const tmpDir = mkdtempSync(join(tmpdir(), "px402-mcp-smoke-"));
  const keypairPath = join(tmpDir, "agent.json");
  writeFileSync(keypairPath, JSON.stringify(secretKey));
  log(`wrote ephemeral keypair to ${keypairPath}`);

  const port = 8910 + Math.floor(Math.random() * 80);
  const { child: demoChild, ready } = bootDemoApis(server.publicKey.toBase58(), port);

  let mcpClient: Client | undefined;
  try {
    await ready;
    log(`demo-apis up on :${port}, giving subscriber 5s head start`);
    await new Promise((r) => setTimeout(r, 5000));

    log("spawning @px402/mcp via stdio");
    const transport = new StdioClientTransport({
      command: "pnpm",
      args: ["--filter", "@px402/mcp", "start"],
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PX402_KEYPAIR_PATH: keypairPath,
        PX402_MINT: "5CmxDcDtDiqwxy9TDVyo1Xjr4AFwQzrH7vKr8cXfkEse",
        PX402_API_URL: "https://payments.magicblock.app",
        PX402_BASE_RPC_URL: "https://api.devnet.solana.com",
        PX402_EPHEMERAL_RPC_URL: "https://devnet.magicblock.app",
        PX402_CLUSTER: "devnet",
        // Devnet crank cadence is ~3-5min after the 2026-05-13 protocol change.
        PX402_RETRY_DELAYS_MS: "3000,6000,12000,30000,60000,120000,300000",
      } as Record<string, string>,
    });

    mcpClient = new Client({ name: "px402-smoke", version: "0.0.0" }, { capabilities: {} });
    await mcpClient.connect(transport);
    log("MCP client connected");

    const tools = await mcpClient.listTools();
    log(`tools: ${tools.tools.map((t) => t.name).join(", ")}`);
    if (!tools.tools.find((t) => t.name === "px402_balance")) throw new Error("px402_balance tool missing");
    if (!tools.tools.find((t) => t.name === "px402_fetch")) throw new Error("px402_fetch tool missing");

    log("calling px402_balance");
    const balRes = await mcpClient.callTool({ name: "px402_balance", arguments: {} });
    const balText = (balRes.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    log(`balance: ${balText}`);
    const bal = JSON.parse(balText) as { amount?: string };
    if (!bal.amount) throw new Error(`balance missing amount: ${balText}`);

    log("calling px402_fetch -> /api/sentiment");
    // Devnet crank cadence is ~3-5min; default MCP-SDK timeout is 60s.
    // The inner Px402Client retries up to ~531s, so the SDK side needs
    // strictly more headroom than that for the final retry to land.
    const fetchRes = await mcpClient.callTool(
      {
        name: "px402_fetch",
        arguments: { url: `http://127.0.0.1:${port}/api/sentiment?token=SOL` },
      },
      undefined,
      { timeout: 1_200_000 },
    );
    const fetchText = (fetchRes.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    log(`fetch: ${fetchText}`);
    const parsed = JSON.parse(fetchText) as { status: number; body: unknown };
    if (parsed.status !== 200) throw new Error(`expected 200, got ${parsed.status}: ${fetchText}`);

    log("PASS");
  } finally {
    try { await mcpClient?.close(); } catch {}
    demoChild.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    if (demoChild.exitCode === null) demoChild.kill("SIGKILL");
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("[mcp-smoke] FAIL:", err);
    process.exit(1);
  },
);
