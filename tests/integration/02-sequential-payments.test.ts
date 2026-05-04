import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ensureFundedWallets } from "./shared/fund-pool.js";
import { ensureServerKeypair } from "./shared/server-keypair.js";
import { spawnServer, type ServerHandle } from "./shared/spawn-server.js";
import { runAgentCall } from "./shared/agent-call.js";

const ENABLED = process.env.PX402_DEVNET === "1";

describe.skipIf(!ENABLED)("02 sequential payments from same wallet", () => {
  let server: ServerHandle;

  beforeAll(async () => {
    const serverKp = ensureServerKeypair();
    await ensureFundedWallets(1);
    server = await spawnServer({ paymentAddress: serverKp.publicKey.toBase58() });
  }, 120_000);

  afterAll(async () => {
    if (server) await server.kill();
  });

  test("5 sequential payments all return 200, distinct paymentIds + sigs", async () => {
    const [wallet] = await ensureFundedWallets(1);
    expect(wallet).toBeDefined();

    const results = [];
    for (let i = 0; i < 5; i++) {
      const r = await runAgentCall(server.url, wallet!, { path: `/api/sentiment?token=SOL&i=${i}` });
      results.push(r);
      console.log(`[02] call ${i + 1}: status=${r.status} latency=${r.latencyMs}ms retries=${r.retries}`);
    }

    for (const r of results) {
      expect(r.status, `error: ${r.error}\nserver log tail:\n${server.getLog().slice(-1500)}`).toBe(200);
      expect(r.signature).toBeTruthy();
    }

    const paymentIds = results.map((r) => r.paymentId);
    const sigs = results.map((r) => r.signature);
    expect(new Set(paymentIds).size).toBe(5);
    expect(new Set(sigs).size).toBe(5);
  }, 300_000);
});
