/**
 * Standalone stress harness. Spawns N agent calls against a px402 demo-apis
 * server with configurable arrival rate, captures per-call timing + outcome,
 * emits a CSV stream on stdout, and writes a JSON summary at the end.
 *
 * Usage:
 *   pnpm --filter px402-scripts stress:burst -- --agents 30 --rate 6 --duration 5
 *   pnpm --filter px402-scripts stress:burst -- --agents 100 --rate 20 --duration 10
 *
 * Flags:
 *   --agents N        total payments to dispatch (default 30)
 *   --rate R          arrivals per second (default 6)
 *   --duration S      max dispatch duration in seconds (default ceil(agents/rate))
 *   --refund          force re-fund the wallet pool
 *   --keep-server     don't kill the spawned server at end (debugging)
 *   --summary PATH    JSON summary file (default tests/integration/.tmp/stress-summary.json)
 *
 * Each test wallet must already have ≥0.05 SOL + ≥0.5 USDC on the px402 mint.
 * The harness uses tests/integration/shared/fund-pool.ts to provision them.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ensureFundedWallets } from "../tests/integration/shared/fund-pool.js";
import { ensureServerKeypair } from "../tests/integration/shared/server-keypair.js";
import { spawnServer } from "../tests/integration/shared/spawn-server.js";
import { runAgentCall, type AgentCallResult } from "../tests/integration/shared/agent-call.js";
import { TMP_DIR } from "../tests/integration/shared/constants.js";

interface CliArgs {
  agents: number;
  rate: number;
  duration: number;
  refund: boolean;
  keepServer: boolean;
  summary: string;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (name: string, fallback?: string) => {
    const idx = argv.indexOf(`--${name}`);
    return idx >= 0 ? argv[idx + 1] ?? fallback : fallback;
  };
  const agents = Number(get("agents", "30"));
  const rate = Number(get("rate", "6"));
  return {
    agents,
    rate,
    duration: Number(get("duration", String(Math.ceil(agents / rate)))),
    refund: argv.includes("--refund"),
    keepServer: argv.includes("--keep-server"),
    summary: get("summary", join(TMP_DIR, "stress-summary.json"))!,
  };
}

interface CallRecord extends AgentCallResult {
  agentIdx: number;
  walletPubkey: string;
  dispatchedAt: number;
  completedAt: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx] ?? 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  process.stderr.write(
    `[stress] agents=${args.agents} rate=${args.rate}/s duration=${args.duration}s\n`,
  );

  const wallets = await ensureFundedWallets(args.agents, { refund: args.refund });
  const serverKp = ensureServerKeypair();
  const server = await spawnServer({
    paymentAddress: serverKp.publicKey.toBase58(),
  });

  process.stderr.write(`[stress] server up at ${server.url}\n`);
  process.stdout.write("agent_idx,wallet,dispatched_at_ms,completed_at_ms,latency_ms,status,retries,payment_id,signature,error\n");

  const arrivalIntervalMs = 1000 / args.rate;
  const startedAt = Date.now();
  const results: CallRecord[] = [];

  const promises: Promise<CallRecord>[] = [];
  for (let i = 0; i < args.agents; i++) {
    const wallet = wallets[i]!;
    const dispatchAt = startedAt + i * arrivalIntervalMs;
    promises.push(
      (async () => {
        const wait = dispatchAt - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        const dispatchedAt = Date.now();
        const r = await runAgentCall(server.url, wallet, {
          path: `/api/sentiment?token=SOL&n=${i}`,
        });
        const completedAt = Date.now();
        const rec: CallRecord = {
          ...r,
          agentIdx: i,
          walletPubkey: wallet.publicKey.toBase58(),
          dispatchedAt,
          completedAt,
        };
        results.push(rec);
        const csvLine = [
          rec.agentIdx,
          rec.walletPubkey,
          rec.dispatchedAt,
          rec.completedAt,
          rec.latencyMs,
          rec.status,
          rec.retries,
          rec.paymentId ?? "",
          rec.signature ?? "",
          (rec.error ?? "").replace(/[,\n]/g, " "),
        ].join(",");
        process.stdout.write(csvLine + "\n");
        return rec;
      })(),
    );
  }

  await Promise.all(promises);

  const successes = results.filter((r) => r.status === 200);
  const failures = results.filter((r) => r.status !== 200);
  const latencies = successes.map((r) => r.latencyMs).sort((a, b) => a - b);
  const summary = {
    args,
    startedAt,
    finishedAt: Date.now(),
    serverUrl: server.url,
    serverPaymentAddress: serverKp.publicKey.toBase58(),
    total: results.length,
    successCount: successes.length,
    failureCount: failures.length,
    successRate: results.length === 0 ? 0 : successes.length / results.length,
    latencyMsP50: percentile(latencies, 0.5),
    latencyMsP90: percentile(latencies, 0.9),
    latencyMsP99: percentile(latencies, 0.99),
    avgRetries: successes.reduce((a, r) => a + r.retries, 0) / Math.max(1, successes.length),
    failures: failures.map((f) => ({
      agentIdx: f.agentIdx,
      status: f.status,
      retries: f.retries,
      error: f.error,
    })),
  };

  if (!existsSync(dirname(args.summary))) mkdirSync(dirname(args.summary), { recursive: true });
  writeFileSync(args.summary, JSON.stringify(summary, null, 2));
  process.stderr.write(
    `\n[stress] success=${summary.successCount}/${summary.total} (${(summary.successRate * 100).toFixed(1)}%) p50=${summary.latencyMsP50}ms p90=${summary.latencyMsP90}ms p99=${summary.latencyMsP99}ms avgRetries=${summary.avgRetries.toFixed(2)}\n`,
  );
  process.stderr.write(`[stress] summary written to ${args.summary}\n`);

  if (!args.keepServer) await server.kill();
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`[stress] fatal: ${err}\n`);
  process.exit(2);
});
