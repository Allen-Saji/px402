import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ensureFundedWallets } from "./shared/fund-pool.js";
import { ensureServerKeypair } from "./shared/server-keypair.js";
import { spawnServer, type ServerHandle } from "./shared/spawn-server.js";
import { runAgentCall } from "./shared/agent-call.js";

const ENABLED = process.env.PX402_DEVNET === "1";

describe.skipIf(!ENABLED)("03 concurrent payments same wallet", () => {
  let server: ServerHandle;

  beforeAll(async () => {
    const serverKp = ensureServerKeypair();
    await ensureFundedWallets(1);
    server = await spawnServer({ paymentAddress: serverKp.publicKey.toBase58() });
  }, 120_000);

  afterAll(async () => {
    if (server) await server.kill();
  });

  test("5 concurrent payments from same wallet, all 200", async () => {
    const [wallet] = await ensureFundedWallets(1);
    expect(wallet).toBeDefined();

    const promises = Array.from({ length: 5 }, (_, i) =>
      runAgentCall(server.url, wallet!, { path: `/api/sentiment?token=SOL&n=${i}` }),
    );
    const results = await Promise.all(promises);

    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      console.log(`[03] call ${i}: status=${r.status} latency=${r.latencyMs}ms retries=${r.retries} sig=${r.signature?.slice(0, 8)}`);
    }

    const failed = results.filter((r) => r.status !== 200);
    expect(failed, `failures:\n${JSON.stringify(failed, null, 2)}\nserver log tail:\n${server.getLog().slice(-2000)}`).toHaveLength(0);

    const paymentIds = results.map((r) => r.paymentId);
    const sigs = results.map((r) => r.signature);
    expect(new Set(paymentIds).size).toBe(5);
    expect(new Set(sigs).size).toBe(5);
  }, 180_000);
});
