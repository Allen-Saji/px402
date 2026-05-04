import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ensureFundedWallets } from "./shared/fund-pool.js";
import { ensureServerKeypair } from "./shared/server-keypair.js";
import { spawnServer, type ServerHandle } from "./shared/spawn-server.js";
import { runAgentCall } from "./shared/agent-call.js";

const ENABLED = process.env.PX402_DEVNET === "1";
const N = 10;

describe.skipIf(!ENABLED)(`04 concurrent payments from ${N} distinct wallets`, () => {
  let server: ServerHandle;

  beforeAll(async () => {
    const serverKp = ensureServerKeypair();
    await ensureFundedWallets(N);
    server = await spawnServer({ paymentAddress: serverKp.publicKey.toBase58() });
  }, 240_000);

  afterAll(async () => {
    if (server) await server.kill();
  });

  test(`${N} concurrent payments from ${N} wallets all return 200`, async () => {
    const wallets = await ensureFundedWallets(N);
    expect(wallets.length).toBeGreaterThanOrEqual(N);

    const promises = wallets.slice(0, N).map((w, i) =>
      runAgentCall(server.url, w, { path: `/api/sentiment?token=SOL&n=${i}` }),
    );
    const results = await Promise.all(promises);

    const successes = results.filter((r) => r.status === 200);
    const failures = results.filter((r) => r.status !== 200);

    console.log(`[04] success=${successes.length}/${N} failures=${failures.length}`);
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      console.log(`  [${i}] status=${r.status} latency=${r.latencyMs}ms retries=${r.retries}${r.error ? ` error=${r.error}` : ""}`);
    }

    if (failures.length > 0) {
      console.log("[04] server log tail:\n" + server.getLog().slice(-3000));
    }

    expect(successes.length).toBeGreaterThanOrEqual(N);

    const sigs = successes.map((r) => r.signature);
    expect(new Set(sigs).size).toBe(successes.length);
  }, 240_000);
});
