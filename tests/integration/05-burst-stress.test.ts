import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ensureFundedWallets } from "./shared/fund-pool.js";
import { ensureServerKeypair } from "./shared/server-keypair.js";
import { spawnServer, type ServerHandle } from "./shared/spawn-server.js";
import { runAgentCall } from "./shared/agent-call.js";

const ENABLED = process.env.PX402_DEVNET === "1";
const N = 30;
const SUCCESS_FLOOR = 28; // allow up to 2 transient failures

describe.skipIf(!ENABLED)(`05 burst stress N=${N}`, () => {
  let server: ServerHandle;

  beforeAll(async () => {
    const serverKp = ensureServerKeypair();
    await ensureFundedWallets(N);
    server = await spawnServer({ paymentAddress: serverKp.publicKey.toBase58() });
  }, 600_000);

  afterAll(async () => {
    if (server) await server.kill();
  });

  test(`${N} payments dispatched within 5s, ≥${SUCCESS_FLOOR} succeed`, async () => {
    const wallets = await ensureFundedWallets(N);
    expect(wallets.length).toBeGreaterThanOrEqual(N);

    // Stagger arrivals across 5 seconds (~6/sec).
    const arrivalIntervalMs = 5000 / N;
    const promises: Promise<Awaited<ReturnType<typeof runAgentCall>>>[] = [];
    for (let i = 0; i < N; i++) {
      const w = wallets[i]!;
      const promise = (async () => {
        await new Promise((r) => setTimeout(r, i * arrivalIntervalMs));
        return runAgentCall(server.url, w, { path: `/api/sentiment?token=SOL&n=${i}` });
      })();
      promises.push(promise);
    }

    const results = await Promise.all(promises);
    const successes = results.filter((r) => r.status === 200);
    const failures = results.filter((r) => r.status !== 200);

    const latencies = successes.map((r) => r.latencyMs).sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
    const p90 = latencies[Math.floor(latencies.length * 0.9)] ?? 0;
    const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? 0;
    const avgRetries = successes.reduce((a, r) => a + r.retries, 0) / Math.max(1, successes.length);

    console.log(`[05] success=${successes.length}/${N} fail=${failures.length} p50=${p50}ms p90=${p90}ms p99=${p99}ms avgRetries=${avgRetries.toFixed(2)}`);
    for (const f of failures) {
      console.log(`  FAIL: status=${f.status} error=${f.error?.slice(0, 200)}`);
    }
    if (successes.length < SUCCESS_FLOOR) {
      console.log("[05] server log tail:\n" + server.getLog().slice(-5000));
    }

    expect(successes.length).toBeGreaterThanOrEqual(SUCCESS_FLOOR);
  }, 600_000);
});
