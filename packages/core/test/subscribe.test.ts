import { describe, expect, it, vi } from "vitest";
import { PrivateTransferSubscriber, type TickEvent } from "../src/subscribe.js";

const QUEUE = "4dA398Eh9P61oGLqebRTYEQD7n4HvwxButoU5NM9C2gu";
const RECEIVER = "8AxCJeRrtfwNVQ5huVoF9cto7Y4Jvw6bP1TUUs2ZnK56";
const OTHER = "9OtherReceiverXxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

function queueInsertLog(clientRefId: string, amount: string) {
  return `Program log: DepositAndQueueTransfer split 1/1 group_id: 1 task_id: 1 client_ref_id: ${clientRefId} amount: ${amount} delay_ms: 0 ready_at: 1776800000000`;
}

function tickPopLog(clientRefId: string, receiver: string) {
  // Matches the pop log format; amount field is intentionally omitted to
  // model MagicBlock's log truncation on long clientRefIds.
  return `Program log: ProcessTransferQueueTick group_id: 1 task_id: 1 client_ref_id: ${clientRefId} sender: SENDER${clientRefId} receiver: ${receiver}`;
}

/** Simpler helper: one tx with both insert + pop logs. */
function paymentLogs(clientRefId: string, receiver: string, amount: string) {
  return [queueInsertLog(clientRefId, amount), tickPopLog(clientRefId, receiver)];
}

function okRpc(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

interface RouteState {
  sigs: Array<{ signature: string; slot: number; err: null | unknown }>;
  txs: Record<string, { logs: string[] }>;
}

function makeFetch(state: RouteState) {
  return vi.fn(async (_input: string | URL, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? "{}") as {
      method: string;
      params: unknown[];
    };
    if (body.method === "getSignaturesForAddress") {
      return okRpc({ jsonrpc: "2.0", id: 1, result: state.sigs });
    }
    if (body.method === "getTransaction") {
      const sig = (body.params[0] as string) ?? "";
      const tx = state.txs[sig];
      return okRpc({
        jsonrpc: "2.0",
        id: 1,
        result: tx ? { slot: 1, meta: { err: null, logMessages: tx.logs } } : null,
      });
    }
    return new Response("bad method", { status: 400 });
  });
}

describe("PrivateTransferSubscriber (polling)", () => {
  it("seeds the watermark on start so pre-existing sigs are ignored", async () => {
    const state: RouteState = {
      sigs: [
        { signature: "older", slot: 1, err: null },
        { signature: "oldest", slot: 0, err: null },
      ],
      txs: {
        older: { logs: paymentLogs("111", RECEIVER, "9990") },
      },
    };
    const fetchMock = makeFetch(state);
    const sub = new PrivateTransferSubscriber({
      rpcUrl: "http://rpc.test",
      queuePda: QUEUE,
      receiverWallet: RECEIVER,
      pollIntervalMs: 10_000, // no polls during test
      fetch: fetchMock as unknown as typeof fetch,
    });
    const emits: unknown[] = [];
    sub.on("tick", (e) => emits.push(e));
    await sub.start();
    await sub.stop();
    expect(emits).toHaveLength(0);
    expect(sub.lookupByClientRefId("111")).toBeUndefined();
  });

  it("emits and indexes a new tick whose receiver matches", async () => {
    const state: RouteState = {
      sigs: [{ signature: "seed1", slot: 1, err: null }],
      txs: {},
    };
    const fetchMock = makeFetch(state);
    const sub = new PrivateTransferSubscriber({
      rpcUrl: "http://rpc.test",
      queuePda: QUEUE,
      receiverWallet: RECEIVER,
      pollIntervalMs: 10,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await sub.start();

    // New tx appears on next poll.
    state.sigs = [
      { signature: "new1", slot: 2, err: null },
      { signature: "seed1", slot: 1, err: null },
    ];
    state.txs.new1 = { logs: paymentLogs("777", RECEIVER, "9990") };

    const waitTick = new Promise<void>((resolve) => sub.once("tick", () => resolve()));
    await waitTick;
    await sub.stop();

    const hit = sub.lookupByClientRefId("777");
    expect(hit).toEqual({
      signature: "new1",
      sender: "SENDER777",
      receiver: RECEIVER,
      amount: "9990",
      clientRefId: "777",
    });
  });

  it("ignores ticks with a different receiver", async () => {
    const state: RouteState = {
      sigs: [],
      txs: {},
    };
    const fetchMock = makeFetch(state);
    const sub = new PrivateTransferSubscriber({
      rpcUrl: "http://rpc.test",
      queuePda: QUEUE,
      receiverWallet: RECEIVER,
      pollIntervalMs: 10,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await sub.start();

    state.sigs = [{ signature: "nope", slot: 2, err: null }];
    state.txs.nope = { logs: paymentLogs("888", OTHER, "10000") };

    await new Promise((r) => setTimeout(r, 40));
    await sub.stop();

    expect(sub.lookupByClientRefId("888")).toBeUndefined();
  });

  it("markSignatureUsed returns false on replay", async () => {
    const fetchMock = makeFetch({ sigs: [], txs: {} });
    const sub = new PrivateTransferSubscriber({
      rpcUrl: "http://rpc.test",
      queuePda: QUEUE,
      receiverWallet: RECEIVER,
      pollIntervalMs: 10_000,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await sub.start();
    await sub.stop();
    expect(sub.markSignatureUsed("sig-r")).toBe(true);
    expect(sub.markSignatureUsed("sig-r")).toBe(false);
  });

  it("onWatermarkAdvance fires with the new sig after each advance, exposes via getWatermark", async () => {
    const state: RouteState = {
      sigs: [{ signature: "seed", slot: 1, err: null }],
      txs: {},
    };
    const fetchMock = makeFetch(state);
    const advances: string[] = [];
    const sub = new PrivateTransferSubscriber({
      rpcUrl: "http://rpc.test",
      queuePda: QUEUE,
      receiverWallet: RECEIVER,
      pollIntervalMs: 10,
      fetch: fetchMock as unknown as typeof fetch,
      onWatermarkAdvance: (sig) => {
        advances.push(sig);
      },
    });
    await sub.start();
    expect(sub.getWatermark()).toBe("seed");
    // Start doesn't fire the callback — only polls do.
    expect(advances).toEqual([]);

    state.sigs = [{ signature: "newer", slot: 2, err: null }, ...state.sigs];
    state.txs.newer = { logs: paymentLogs("321", RECEIVER, "9990") };

    await new Promise<void>((resolve) => sub.once("tick", () => resolve()));
    // Give the post-poll callback a tick to run.
    await new Promise((r) => setTimeout(r, 20));
    await sub.stop();

    expect(advances).toContain("newer");
    expect(sub.getWatermark()).toBe("newer");
  });

  it("onWatermarkAdvance throwing emits error but keeps subscriber alive", async () => {
    const state: RouteState = {
      sigs: [{ signature: "seed", slot: 1, err: null }],
      txs: {},
    };
    const fetchMock = makeFetch(state);
    const errors: Error[] = [];
    const sub = new PrivateTransferSubscriber({
      rpcUrl: "http://rpc.test",
      queuePda: QUEUE,
      receiverWallet: RECEIVER,
      pollIntervalMs: 10,
      fetch: fetchMock as unknown as typeof fetch,
      onWatermarkAdvance: () => {
        throw new Error("disk full");
      },
    });
    sub.on("error", (e) => errors.push(e));
    await sub.start();

    state.sigs = [{ signature: "newer", slot: 2, err: null }, ...state.sigs];
    state.txs.newer = { logs: paymentLogs("999", RECEIVER, "9990") };
    await new Promise<void>((resolve) => sub.once("tick", () => resolve()));
    await new Promise((r) => setTimeout(r, 20));
    await sub.stop();

    expect(errors.map((e) => e.message)).toContain("disk full");
    // Subscriber still indexed the tick — failure of persistence layer doesn't block payment verification.
    expect(sub.lookupByClientRefId("999")).toBeDefined();
  });

  it("restart with initialWatermark backfills sigs landed during the crash window", async () => {
    // Phase 1: a subscriber sees `seed1` only, persists watermark to `persisted`.
    const state: RouteState = {
      sigs: [{ signature: "seed1", slot: 1, err: null }],
      txs: {},
    };
    const fetchMock = makeFetch(state);
    let persisted: string | null = null;
    const sub1 = new PrivateTransferSubscriber({
      rpcUrl: "http://rpc.test",
      queuePda: QUEUE,
      receiverWallet: RECEIVER,
      pollIntervalMs: 10,
      fetch: fetchMock as unknown as typeof fetch,
      onWatermarkAdvance: (sig) => {
        persisted = sig;
      },
    });
    await sub1.start();
    expect(sub1.getWatermark()).toBe("seed1");
    await sub1.stop();
    // No real payments landed yet — persisted may still be null because watermark didn't advance past start.
    persisted ??= "seed1";

    // Phase 2: while server was "down", a real payment landed (sig=crash_window).
    state.sigs = [
      { signature: "crash_window", slot: 2, err: null },
      { signature: "seed1", slot: 1, err: null },
    ];
    state.txs.crash_window = { logs: paymentLogs("42", RECEIVER, "9990") };

    // Phase 3: new subscriber boots with persisted watermark instead of current tip.
    const ticks: TickEvent[] = [];
    const sub2 = new PrivateTransferSubscriber({
      rpcUrl: "http://rpc.test",
      queuePda: QUEUE,
      receiverWallet: RECEIVER,
      pollIntervalMs: 10,
      initialWatermark: persisted,
      fetch: fetchMock as unknown as typeof fetch,
    });
    sub2.on("tick", (e) => ticks.push(e));
    await sub2.start();
    await new Promise<void>((resolve) => sub2.once("tick", () => resolve()));
    await sub2.stop();

    expect(ticks.map((t) => t.clientRefId)).toContain("42");
    expect(sub2.lookupByClientRefId("42")).toBeDefined();
  });

  it("stop() awaits in-flight poll and aborts pending fetch", async () => {
    // Fetch that takes a long time unless aborted, simulating a slow RPC.
    let aborted = false;
    let fetchStarted = false;
    const slowFetch = vi.fn((_input: string | URL, init?: RequestInit) => {
      fetchStarted = true;
      return new Promise<Response>((resolve, reject) => {
        const t = setTimeout(() => resolve(okRpc({ jsonrpc: "2.0", id: 1, result: [] })), 30_000);
        if (init?.signal) {
          init.signal.addEventListener("abort", () => {
            aborted = true;
            clearTimeout(t);
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    });
    const sub = new PrivateTransferSubscriber({
      rpcUrl: "http://rpc.test",
      queuePda: QUEUE,
      receiverWallet: RECEIVER,
      pollIntervalMs: 5,
      // Pre-seed so start() doesn't make an RPC call and we can wait for the poll fetch.
      initialWatermark: "seed",
      fetch: slowFetch as unknown as typeof fetch,
    });
    const errors: Error[] = [];
    const stalls: unknown[] = [];
    sub.on("error", (e) => errors.push(e));
    sub.on("stalled", (e) => stalls.push(e));
    await sub.start();
    // Wait until the first poll's fetch is actually in flight.
    while (!fetchStarted) await new Promise((r) => setTimeout(r, 5));

    const t0 = Date.now();
    await sub.stop(2000);
    const elapsed = Date.now() - t0;

    expect(aborted).toBe(true);
    expect(elapsed).toBeLessThan(500); // didn't wait the 30s slow-fetch timeout
    expect(errors).toHaveLength(0); // abort error is swallowed
    expect(stalls).toHaveLength(0);
  });

  it("expires tick entries after ttlMs", async () => {
    const state: RouteState = {
      sigs: [],
      txs: {},
    };
    const fetchMock = makeFetch(state);
    const sub = new PrivateTransferSubscriber({
      rpcUrl: "http://rpc.test",
      queuePda: QUEUE,
      receiverWallet: RECEIVER,
      pollIntervalMs: 10,
      ttlMs: 50,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await sub.start();

    state.sigs = [{ signature: "sigTtl", slot: 2, err: null }];
    state.txs.sigTtl = { logs: paymentLogs("999", RECEIVER, "9990") };

    const waitTick = new Promise<void>((resolve) => sub.once("tick", () => resolve()));
    await waitTick;
    expect(sub.lookupByClientRefId("999")).toBeDefined();

    await new Promise((r) => setTimeout(r, 80));
    expect(sub.lookupByClientRefId("999")).toBeUndefined();
    await sub.stop();
  });
});
