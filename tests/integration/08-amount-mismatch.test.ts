/**
 * Amount mismatch — agent pays less than the quoted amount; server should
 * detect via verifyPayment's tolerance check and return 402 amount_mismatch.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Px402Client } from "@px402/client";
import { ensureFundedWallets } from "./shared/fund-pool.js";
import { ensureServerKeypair } from "./shared/server-keypair.js";
import { spawnServer, type ServerHandle } from "./shared/spawn-server.js";
import {
  PX402_API_URL,
  PX402_BASE_RPC_URL,
  PX402_CLUSTER,
  PX402_EPHEMERAL_RPC_URL,
  PX402_USDC_MINT,
} from "./shared/constants.js";

const ENABLED = process.env.PX402_DEVNET === "1";

describe.skipIf(!ENABLED)("08 amount mismatch", () => {
  let server: ServerHandle;

  beforeAll(async () => {
    const serverKp = ensureServerKeypair();
    await ensureFundedWallets(1);
    server = await spawnServer({ paymentAddress: serverKp.publicKey.toBase58() });
  }, 120_000);

  afterAll(async () => {
    if (server) await server.kill();
  });

  test("paying half the quoted amount triggers amount_mismatch", async () => {
    const [wallet] = await ensureFundedWallets(1);
    expect(wallet).toBeDefined();

    // Step 1: get a 402.
    const res402 = await fetch(`${server.url}/api/sentiment?token=SOL&am=1`);
    expect(res402.status).toBe(402);
    const paymentId = res402.headers.get("X-Payment-Id")!;
    const token = res402.headers.get("X-Payment-Token")!;
    const quotedAmount = res402.headers.get("X-Payment-Amount")!;
    const destination = res402.headers.get("X-Payment-Address")!;
    expect(paymentId).toBeTruthy();
    expect(quotedAmount).toBe("10000");

    // Step 2: pay HALF the quoted amount.
    const client = new Px402Client({
      wallet: wallet!,
      mint: PX402_USDC_MINT,
      apiUrl: PX402_API_URL,
      baseRpcUrl: PX402_BASE_RPC_URL,
      ephemeralRpcUrl: PX402_EPHEMERAL_RPC_URL,
      cluster: PX402_CLUSTER,
    });
    const halfAmount = BigInt(quotedAmount) / 2n;
    const sig = await client.transfer({
      destination,
      amount: halfAmount,
      clientRefId: paymentId,
    });
    console.log(`[08] paid ${halfAmount} (quoted ${quotedAmount}), sig=${sig}`);

    // Step 3: poll the server until it observes the (incorrect) payment.
    // Devnet crank cadence is ~3-5min after the 2026-05-13 protocol change.
    const deadline = Date.now() + 540_000;
    let outcome: { status: number; body: unknown } | null = null;
    while (Date.now() < deadline) {
      const res = await fetch(`${server.url}/api/sentiment?token=SOL&am=1`, {
        headers: { "X-Payment-Id": paymentId, "X-Payment-Token": token },
      });
      const body = await res.json().catch(() => null);
      console.log(`[08] retry status=${res.status} body=${JSON.stringify(body)}`);
      if (res.status !== 402 || (body as { error?: string } | null)?.error !== "payment_pending") {
        outcome = { status: res.status, body };
        break;
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }

    expect(outcome, "expected a non-pending response").not.toBeNull();
    expect(outcome!.status).toBe(402);
    expect(outcome!.body).toMatchObject({ error: "amount_mismatch" });
  }, 600_000);
});
