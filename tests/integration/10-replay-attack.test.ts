/**
 * Replay attack — pay once, get 200, then resubmit the exact same paymentId +
 * token combo. Server's verifyPayment marks signatureUsed on first call;
 * second call returns "replay" → 409.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ensureFundedWallets } from "./shared/fund-pool.js";
import { ensureServerKeypair } from "./shared/server-keypair.js";
import { spawnServer, type ServerHandle } from "./shared/spawn-server.js";
import { runAgentCall } from "./shared/agent-call.js";

const ENABLED = process.env.PX402_DEVNET === "1";

describe.skipIf(!ENABLED)("10 replay attack", () => {
  let server: ServerHandle;

  beforeAll(async () => {
    const serverKp = ensureServerKeypair();
    await ensureFundedWallets(1);
    server = await spawnServer({ paymentAddress: serverKp.publicKey.toBase58() });
  }, 120_000);

  afterAll(async () => {
    if (server) await server.kill();
  });

  test("resubmitting same paymentId after success returns 409 replay", async () => {
    const [wallet] = await ensureFundedWallets(1);
    expect(wallet).toBeDefined();

    // Step 1: a normal successful payment via the client. Capture the credentials.
    let firstPaymentId: string | undefined;
    let firstToken: string | undefined;
    const original = await runAgentCall(server.url, wallet!, { path: "/api/sentiment?token=SOL&rp=1" });
    expect(original.status, `first call failed: ${original.error}`).toBe(200);
    firstPaymentId = original.paymentId;

    // We don't have the token from runAgentCall; do a parallel direct flow to
    // capture it. Get a 402 + token, store it, then succeed via runAgentCall to
    // mark the sig used.
    const res402 = await fetch(`${server.url}/api/sentiment?token=SOL&rp=2`);
    expect(res402.status).toBe(402);
    firstPaymentId = res402.headers.get("X-Payment-Id")!;
    firstToken = res402.headers.get("X-Payment-Token")!;

    // Pay the second one.
    const { Px402Client } = await import("@px402/client");
    const { PX402_API_URL, PX402_BASE_RPC_URL, PX402_CLUSTER, PX402_EPHEMERAL_RPC_URL, PX402_USDC_MINT } =
      await import("./shared/constants.js");
    const client = new Px402Client({
      wallet: wallet!,
      mint: PX402_USDC_MINT,
      apiUrl: PX402_API_URL,
      baseRpcUrl: PX402_BASE_RPC_URL,
      ephemeralRpcUrl: PX402_EPHEMERAL_RPC_URL,
      cluster: PX402_CLUSTER,
    });
    await client.transfer({
      destination: server.paymentAddress,
      amount: BigInt(10000),
      clientRefId: firstPaymentId,
    });

    // Step 2: poll until server verifies (200).
    // Devnet crank cadence is ~3-5min after the 2026-05-13 protocol change.
    const deadline = Date.now() + 540_000;
    let firstSuccess = false;
    while (Date.now() < deadline) {
      const res = await fetch(`${server.url}/api/sentiment?token=SOL&rp=2`, {
        headers: { "X-Payment-Id": firstPaymentId, "X-Payment-Token": firstToken },
      });
      if (res.status === 200) {
        firstSuccess = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    expect(firstSuccess).toBe(true);

    // Step 3: replay attack. Same paymentId + token, same path.
    const replayRes = await fetch(`${server.url}/api/sentiment?token=SOL&rp=2`, {
      headers: { "X-Payment-Id": firstPaymentId, "X-Payment-Token": firstToken },
    });
    const body = await replayRes.json().catch(() => null);
    console.log(`[10] replay status=${replayRes.status} body=${JSON.stringify(body)}`);
    expect(replayRes.status).toBe(409);
    expect(body).toMatchObject({ error: "replay" });
  }, 900_000);
});
