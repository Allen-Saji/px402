import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ensureFundedWallets } from "./shared/fund-pool.js";
import { ensureServerKeypair } from "./shared/server-keypair.js";
import { spawnServer, type ServerHandle } from "./shared/spawn-server.js";
import { runAgentCall } from "./shared/agent-call.js";

const ENABLED = process.env.PX402_DEVNET === "1";

describe.skipIf(!ENABLED)("01 single payment", () => {
  let server: ServerHandle;

  beforeAll(async () => {
    const serverKp = ensureServerKeypair();
    await ensureFundedWallets(1);
    server = await spawnServer({ paymentAddress: serverKp.publicKey.toBase58() });
  }, 120_000);

  afterAll(async () => {
    if (server) await server.kill();
  });

  test("agent pays once, server returns 200 with body + signature header", async () => {
    const [wallet] = await ensureFundedWallets(1);
    expect(wallet).toBeDefined();
    const result = await runAgentCall(server.url, wallet!);
    console.log("[01] result:", { status: result.status, latencyMs: result.latencyMs, retries: result.retries });
    expect(result.status, `error: ${result.error}\nserver log:\n${server.getLog().slice(-2000)}`).toBe(200);
    expect(result.signature).toBeTruthy();
    expect(result.paymentId).toBeTruthy();
    expect(result.latencyMs).toBeLessThan(60_000);
    expect(result.body).toMatchObject({ token: "SOL" });
  }, 90_000);
});
