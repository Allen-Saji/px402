import { describe, expect, it, vi } from "vitest";
import { PrivateTransferSubscriber } from "../src/subscribe.js";

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
    sub.stop();
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
    sub.stop();

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
    sub.stop();

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
    sub.stop();
    expect(sub.markSignatureUsed("sig-r")).toBe(true);
    expect(sub.markSignatureUsed("sig-r")).toBe(false);
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
    sub.stop();
  });
});
