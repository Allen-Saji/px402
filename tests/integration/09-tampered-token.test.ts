/**
 * Tampered token — flip a byte in the X-Payment-Token; HMAC verify fails;
 * server returns 401.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ensureFundedWallets } from "./shared/fund-pool.js";
import { ensureServerKeypair } from "./shared/server-keypair.js";
import { spawnServer, type ServerHandle } from "./shared/spawn-server.js";

const ENABLED = process.env.PX402_DEVNET === "1";

describe.skipIf(!ENABLED)("09 tampered token", () => {
  let server: ServerHandle;

  beforeAll(async () => {
    const serverKp = ensureServerKeypair();
    await ensureFundedWallets(1);
    server = await spawnServer({ paymentAddress: serverKp.publicKey.toBase58() });
  }, 120_000);

  afterAll(async () => {
    if (server) await server.kill();
  });

  test("flipping a payload byte yields 401 invalid_token", async () => {
    const res402 = await fetch(`${server.url}/api/sentiment?token=SOL&tt=1`);
    expect(res402.status).toBe(402);
    const paymentId = res402.headers.get("X-Payment-Id")!;
    const token = res402.headers.get("X-Payment-Token")!;

    // Token shape: v1.<payloadB64Url>.<sigB64Url>
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    const payload = parts[1]!;
    // Flip the first character of the payload (changes the JSON, sig won't match).
    const flipped = (payload.charAt(0) === "A" ? "B" : "A") + payload.slice(1);
    const tampered = `${parts[0]}.${flipped}.${parts[2]}`;

    const res = await fetch(`${server.url}/api/sentiment?token=SOL&tt=1`, {
      headers: { "X-Payment-Id": paymentId, "X-Payment-Token": tampered },
    });
    const body = await res.json().catch(() => null);
    console.log(`[09] status=${res.status} body=${JSON.stringify(body)}`);
    expect(res.status).toBe(401);
    expect(body).toMatchObject({ error: "invalid_token" });
  }, 60_000);
});
