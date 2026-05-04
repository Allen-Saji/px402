/**
 * Token expiry — proves that an expired payment token is rejected with a 402
 * carrying `reason: "expired"` and a fresh paymentId/token. This is the signal
 * the client uses to start a new pay cycle.
 *
 * We override the server's tokenTtlMs to 3 seconds so this completes fast.
 *
 * NOTE: We don't drive a full client.fetch() recovery here because the client's
 * retry schedule + per-attempt token TTL would race in a way that's not the
 * subject of this test. The client integration is already covered by 02/03/04.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ensureServerKeypair } from "./shared/server-keypair.js";
import { spawnServer, type ServerHandle } from "./shared/spawn-server.js";

const ENABLED = process.env.PX402_DEVNET === "1";

describe.skipIf(!ENABLED)("07 token expiry", () => {
  let server: ServerHandle;

  beforeAll(async () => {
    const serverKp = ensureServerKeypair();
    server = await spawnServer({
      paymentAddress: serverKp.publicKey.toBase58(),
      tokenTtlMs: 3_000,
    });
  }, 120_000);

  afterAll(async () => {
    if (server) await server.kill();
  });

  test("expired token retry yields fresh 402 with reason=expired", async () => {
    const res402 = await fetch(`${server.url}/api/sentiment?token=SOL&exp=1`);
    expect(res402.status).toBe(402);
    const oldId = res402.headers.get("X-Payment-Id");
    const oldToken = res402.headers.get("X-Payment-Token");
    expect(oldId).toBeTruthy();
    expect(oldToken).toBeTruthy();

    // Wait past the 3s TTL.
    await new Promise((r) => setTimeout(r, 5_000));

    const expiredRes = await fetch(`${server.url}/api/sentiment?token=SOL&exp=1`, {
      headers: { "X-Payment-Id": oldId!, "X-Payment-Token": oldToken! },
    });
    const body = (await expiredRes.json()) as { reason?: string; error?: string };
    console.log(`[07] status=${expiredRes.status} body=${JSON.stringify(body)}`);
    expect(expiredRes.status).toBe(402);
    expect(body.reason).toBe("expired");

    const newId = expiredRes.headers.get("X-Payment-Id");
    const newToken = expiredRes.headers.get("X-Payment-Token");
    expect(newId).toBeTruthy();
    expect(newToken).toBeTruthy();
    expect(newId).not.toBe(oldId);
    expect(newToken).not.toBe(oldToken);
  }, 30_000);
});
