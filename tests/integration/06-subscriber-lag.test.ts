/**
 * Subscriber lag — proves the orphan-pop backwards-recovery path.
 *
 * Strategy:
 *   1. Submit a payment via Px402Client.transfer with a known clientRefId.
 *   2. Poll the queue PDA directly to find the on-chain INSERT signature for
 *      that clientRefId.
 *   3. Spin up a fresh PrivateTransferSubscriber with `initialWatermark` set
 *      to the INSERT signature. By definition the subscriber's first forward
 *      poll will return sigs strictly newer than insert — so the POP appears
 *      forward but its matching INSERT is invisible.
 *   4. Pop is buffered as orphan. After 3 × pollIntervalMs, the backwards-scan
 *      kicks in, walks 50 sigs back, finds INSERT, completes the verification.
 *   5. Assert `tick` event fires for our clientRefId AND the server log says
 *      "recovered via backwards-scan".
 *
 * This is the only deterministic way to exercise the orphan path without
 * mocks. Concurrent-payment tests don't trigger it because the new two-pass
 * apply already orders insert-before-pop within a chunk.
 */
import { describe, expect, test } from "vitest";
import {
  PrivateTransferSubscriber,
  deriveQueuePda,
  type TickEvent,
} from "@px402/core";
import { Px402Client } from "@px402/client";
import { ensureFundedWallets } from "./shared/fund-pool.js";
import { ensureServerKeypair } from "./shared/server-keypair.js";
import {
  PX402_API_URL,
  PX402_BASE_RPC_URL,
  PX402_CLUSTER,
  PX402_EPHEMERAL_RPC_URL,
  PX402_USDC_MINT,
  PX402_VALIDATOR,
} from "./shared/constants.js";

const ENABLED = process.env.PX402_DEVNET === "1";

interface RpcSig {
  signature: string;
  slot: number;
  err: unknown;
}

async function findInsertSig(
  rpcUrl: string,
  queuePda: string,
  clientRefId: string,
  deadlineMs: number,
): Promise<{ signature: string; slot: number }> {
  const insertNeedle = `client_ref_id: ${clientRefId} amount:`;
  while (Date.now() < deadlineMs) {
    const sigsRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignaturesForAddress",
        params: [queuePda, { limit: 50 }],
      }),
    });
    const sigsJson = (await sigsRes.json()) as { result?: RpcSig[] };
    const sigs = sigsJson.result ?? [];
    for (const s of sigs) {
      if (s.err) continue;
      const txRes = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: [s.signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 }],
        }),
      });
      const txJson = (await txRes.json()) as {
        result?: { slot: number; meta?: { logMessages?: string[] } } | null;
      };
      const logs = txJson.result?.meta?.logMessages ?? [];
      for (const line of logs) {
        if (line.includes(insertNeedle)) {
          return { signature: s.signature, slot: s.slot };
        }
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`insert for clientRefId=${clientRefId} not found before deadline`);
}

describe.skipIf(!ENABLED)("06 subscriber lag (orphan backwards-recovery)", () => {
  test("orphan pop is recovered via backwards-scan", async () => {
    const wallets = await ensureFundedWallets(1);
    const wallet = wallets[0]!;
    const serverKp = ensureServerKeypair();
    const queuePda = deriveQueuePda(PX402_USDC_MINT, PX402_VALIDATOR).toBase58();

    // Step 1: submit a payment with a known clientRefId.
    const clientRefId = String(Date.now()) + String(Math.floor(Math.random() * 1_000_000));
    const client = new Px402Client({
      wallet,
      mint: PX402_USDC_MINT,
      apiUrl: PX402_API_URL,
      baseRpcUrl: PX402_BASE_RPC_URL,
      ephemeralRpcUrl: PX402_EPHEMERAL_RPC_URL,
      cluster: PX402_CLUSTER,
    });
    const transferSig = await client.transfer({
      destination: serverKp.publicKey.toBase58(),
      amount: BigInt(10000),
      clientRefId,
    });
    console.log(`[06] payment submitted clientRefId=${clientRefId} sig=${transferSig}`);

    // Step 2: find the on-chain INSERT signature for our clientRefId.
    const insertHit = await findInsertSig(
      PX402_EPHEMERAL_RPC_URL,
      queuePda,
      clientRefId,
      Date.now() + 30_000,
    );
    console.log(`[06] insert located at sig=${insertHit.signature} slot=${insertHit.slot}`);

    // Step 3: stand up a subscriber with watermark = insert sig. Pop will appear
    //         forward; insert will not.
    const ticks: TickEvent[] = [];
    const errors: Error[] = [];
    const logBuffer: string[] = [];
    const subscriber = new PrivateTransferSubscriber({
      rpcUrl: PX402_EPHEMERAL_RPC_URL,
      queuePda,
      receiverWallet: serverKp.publicKey.toBase58(),
      pollIntervalMs: 500,
      initialWatermark: insertHit.signature,
      logger: {
        info: (m) => logBuffer.push(`INFO  ${m}`),
        warn: (m) => logBuffer.push(`WARN  ${m}`),
        error: (m) => logBuffer.push(`ERROR ${m}`),
      },
    });
    subscriber.on("tick", (e) => {
      ticks.push(e);
      console.log(`[06] tick ref=${e.clientRefId} sig=${e.signature.slice(0, 12)}…`);
    });
    subscriber.on("error", (e) => errors.push(e));

    try {
      await subscriber.start();

      // Step 4: wait for the orphan path to fire and resolve.
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (ticks.find((t) => t.clientRefId === clientRefId)) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    } finally {
      subscriber.stop();
    }

    const tick = ticks.find((t) => t.clientRefId === clientRefId);
    const log = logBuffer.join("\n");
    if (!tick) console.log("[06] subscriber log:\n" + log);
    expect(tick, `no tick for ${clientRefId}\nlog:\n${log}`).toBeTruthy();
    expect(tick!.amount).toBe("10000");
    expect(tick!.receiver).toBe(serverKp.publicKey.toBase58());

    // Step 5: confirm orphan path actually ran (not just lucky forward indexing).
    const orphanBuffered = log.includes(`orphan pop ref=${clientRefId} buffered`);
    const orphanResolved =
      log.includes(`orphan ref=${clientRefId} resolved`) ||
      log.includes(`orphan ref=${clientRefId} recovered via backwards-scan`);
    console.log(`[06] orphanBuffered=${orphanBuffered} orphanResolved=${orphanResolved}`);
    expect(orphanBuffered, "orphan should have been buffered").toBe(true);
    expect(orphanResolved, "orphan should have been resolved").toBe(true);
    expect(errors.filter((e) => e.message.includes("unrecoverable"))).toHaveLength(0);
  }, 120_000);
});
