import { describe, expect, it, vi } from "vitest";
import {
  PrivateTransferSubscriber,
  type SubscriberConfig,
  type TickEvent,
} from "../src/subscribe.js";

const QUEUE = "4dA398Eh9P61oGLqebRTYEQD7n4HvwxButoU5NM9C2gu";
const RECEIVER = "8AxCJeRrtfwNVQ5huVoF9cto7Y4Jvw6bP1TUUs2ZnK56";
const OTHER = "9OtherReceiverXxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const MINT = "5CmxDcDtDiqwxy9TDVyo1Xjr4AFwQzrH7vKr8cXfkEse";
const OTHER_MINT = "9DiffMintXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner: string;
  uiTokenAmount: { amount: string };
}

interface FixtureTx {
  logs: string[];
  pre: TokenBalance[];
  post: TokenBalance[];
}

/**
 * Build a fixture tx that mimics a base-chain ExecuteReadyQueuedTransfer:
 * - logs include the marker line + `client_ref_id: N`
 * - receiver ATA gains `amount` on mint
 * - sender ATA loses `amount` on mint
 */
function paymentTx(opts: {
  clientRefId: string;
  sender: string;
  receiver: string;
  amount: string;
  mint?: string;
  /** Override to omit the marker line — used to test the "not us" filter. */
  withoutExecuteLine?: boolean;
  /** Override to omit the client_ref_id line — used to test fallthrough. */
  withoutRefId?: boolean;
}): FixtureTx {
  const mint = opts.mint ?? MINT;
  const baseReceiver = 100_000n;
  const baseSender = 1_000_000n;
  const amt = BigInt(opts.amount);
  const logs = [
    "Program ComputeBudget111111111111111111111111111111 invoke [1]",
    "Program ComputeBudget111111111111111111111111111111 success",
    "Program DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh invoke [1]",
    "Program SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2 invoke [2]",
    ...(opts.withoutExecuteLine ? [] : ["Program log: Instruction: ExecuteReadyQueuedTransfer"]),
    ...(opts.withoutRefId ? [] : [`Program log: client_ref_id: ${opts.clientRefId}`]),
    "Program SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2 success",
    "Program DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh success",
  ];
  return {
    logs,
    pre: [
      { accountIndex: 2, mint, owner: opts.receiver, uiTokenAmount: { amount: baseReceiver.toString() } },
      { accountIndex: 6, mint, owner: opts.sender, uiTokenAmount: { amount: (baseSender + amt).toString() } },
    ],
    post: [
      { accountIndex: 2, mint, owner: opts.receiver, uiTokenAmount: { amount: (baseReceiver + amt).toString() } },
      { accountIndex: 6, mint, owner: opts.sender, uiTokenAmount: { amount: baseSender.toString() } },
    ],
  };
}

function okRpc(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

interface RouteState {
  sigs: Array<{ signature: string; slot: number; err: null | unknown }>;
  txs: Record<string, FixtureTx>;
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
        result: tx
          ? {
              slot: 1,
              meta: {
                err: null,
                logMessages: tx.logs,
                preTokenBalances: tx.pre,
                postTokenBalances: tx.post,
              },
            }
          : null,
      });
    }
    return new Response("bad method", { status: 400 });
  });
}

function makeSubscriber(
  state: RouteState,
  overrides: Partial<SubscriberConfig> = {},
): PrivateTransferSubscriber {
  return new PrivateTransferSubscriber({
    rpcUrl: "http://rpc.test",
    queuePda: QUEUE,
    mint: MINT,
    receiverWallet: RECEIVER,
    pollIntervalMs: 10,
    fetch: makeFetch(state) as unknown as typeof fetch,
    ...overrides,
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
        older: paymentTx({ clientRefId: "111", sender: OTHER, receiver: RECEIVER, amount: "9990" }),
      },
    };
    const sub = makeSubscriber(state, { pollIntervalMs: 10_000 });
    const emits: unknown[] = [];
    sub.on("tick", (e) => emits.push(e));
    await sub.start();
    await sub.stop();
    expect(emits).toHaveLength(0);
    expect(sub.lookupByClientRefId("111")).toBeUndefined();
  });

  it("emits and indexes a new tick whose receiver and mint match", async () => {
    const state: RouteState = {
      sigs: [{ signature: "seed1", slot: 1, err: null }],
      txs: {},
    };
    const sub = makeSubscriber(state);
    await sub.start();

    state.sigs = [
      { signature: "new1", slot: 2, err: null },
      { signature: "seed1", slot: 1, err: null },
    ];
    state.txs.new1 = paymentTx({
      clientRefId: "777",
      sender: "SENDER777Pubkey",
      receiver: RECEIVER,
      amount: "9990",
    });

    const waitTick = new Promise<void>((resolve) => sub.once("tick", () => resolve()));
    await waitTick;
    await sub.stop();

    const hit = sub.lookupByClientRefId("777");
    expect(hit).toEqual({
      signature: "new1",
      sender: "SENDER777Pubkey",
      receiver: RECEIVER,
      amount: "9990",
      clientRefId: "777",
    });
  });

  it("ignores ticks with a different receiver", async () => {
    const state: RouteState = { sigs: [], txs: {} };
    const sub = makeSubscriber(state);
    await sub.start();

    state.sigs = [{ signature: "nope", slot: 2, err: null }];
    state.txs.nope = paymentTx({
      clientRefId: "888",
      sender: "Sx",
      receiver: OTHER,
      amount: "10000",
    });

    await new Promise((r) => setTimeout(r, 40));
    await sub.stop();

    expect(sub.lookupByClientRefId("888")).toBeUndefined();
  });

  it("ignores ticks on a different mint even when receiver matches", async () => {
    const state: RouteState = { sigs: [], txs: {} };
    const sub = makeSubscriber(state);
    await sub.start();

    state.sigs = [{ signature: "wrongmint", slot: 2, err: null }];
    state.txs.wrongmint = paymentTx({
      clientRefId: "555",
      sender: "Sx",
      receiver: RECEIVER,
      amount: "10000",
      mint: OTHER_MINT,
    });

    await new Promise((r) => setTimeout(r, 40));
    await sub.stop();

    expect(sub.lookupByClientRefId("555")).toBeUndefined();
  });

  it("ignores txs without an ExecuteReadyQueuedTransfer log line", async () => {
    const state: RouteState = { sigs: [], txs: {} };
    const sub = makeSubscriber(state);
    await sub.start();

    state.sigs = [{ signature: "irrelevant", slot: 2, err: null }];
    state.txs.irrelevant = paymentTx({
      clientRefId: "666",
      sender: "Sx",
      receiver: RECEIVER,
      amount: "10000",
      withoutExecuteLine: true,
    });

    await new Promise((r) => setTimeout(r, 40));
    await sub.stop();

    expect(sub.lookupByClientRefId("666")).toBeUndefined();
  });

  it("warns and skips ExecuteReadyQueuedTransfer with no client_ref_id", async () => {
    const warnings: string[] = [];
    const state: RouteState = { sigs: [], txs: {} };
    const sub = makeSubscriber(state, {
      logger: {
        info: () => {},
        warn: (m: string) => warnings.push(m),
        error: () => {},
      },
    });
    await sub.start();

    state.sigs = [{ signature: "no_ref", slot: 2, err: null }];
    state.txs.no_ref = paymentTx({
      clientRefId: "unused",
      sender: "Sx",
      receiver: RECEIVER,
      amount: "10000",
      withoutRefId: true,
    });

    await new Promise((r) => setTimeout(r, 40));
    await sub.stop();

    expect(warnings.some((w) => w.includes("no client_ref_id"))).toBe(true);
  });

  it("markSignatureUsed returns false on replay", async () => {
    const sub = makeSubscriber({ sigs: [], txs: {} }, { pollIntervalMs: 10_000 });
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
    const advances: string[] = [];
    const sub = makeSubscriber(state, {
      onWatermarkAdvance: (sig: string) => {
        advances.push(sig);
      },
    });
    await sub.start();
    expect(sub.getWatermark()).toBe("seed");
    expect(advances).toEqual([]);

    state.sigs = [{ signature: "newer", slot: 2, err: null }, ...state.sigs];
    state.txs.newer = paymentTx({
      clientRefId: "321",
      sender: "Sx",
      receiver: RECEIVER,
      amount: "9990",
    });

    await new Promise<void>((resolve) => sub.once("tick", () => resolve()));
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
    const errors: Error[] = [];
    const sub = makeSubscriber(state, {
      onWatermarkAdvance: () => {
        throw new Error("disk full");
      },
    });
    sub.on("error", (e) => errors.push(e));
    await sub.start();

    state.sigs = [{ signature: "newer", slot: 2, err: null }, ...state.sigs];
    state.txs.newer = paymentTx({
      clientRefId: "999",
      sender: "Sx",
      receiver: RECEIVER,
      amount: "9990",
    });
    await new Promise<void>((resolve) => sub.once("tick", () => resolve()));
    await new Promise((r) => setTimeout(r, 20));
    await sub.stop();

    expect(errors.map((e) => e.message)).toContain("disk full");
    // Subscriber still indexed the tick — failure of persistence layer doesn't block payment verification.
    expect(sub.lookupByClientRefId("999")).toBeDefined();
  });

  it("restart with initialWatermark backfills sigs landed during the crash window", async () => {
    const state: RouteState = {
      sigs: [{ signature: "seed1", slot: 1, err: null }],
      txs: {},
    };
    let persisted: string | null = null;
    const sub1 = makeSubscriber(state, {
      onWatermarkAdvance: (sig: string) => {
        persisted = sig;
      },
    });
    await sub1.start();
    expect(sub1.getWatermark()).toBe("seed1");
    await sub1.stop();
    persisted ??= "seed1";

    state.sigs = [
      { signature: "crash_window", slot: 2, err: null },
      { signature: "seed1", slot: 1, err: null },
    ];
    state.txs.crash_window = paymentTx({
      clientRefId: "42",
      sender: "Sx",
      receiver: RECEIVER,
      amount: "9990",
    });

    const ticks: TickEvent[] = [];
    const sub2 = makeSubscriber(state, { initialWatermark: persisted });
    sub2.on("tick", (e) => ticks.push(e));
    await sub2.start();
    await new Promise<void>((resolve) => sub2.once("tick", () => resolve()));
    await sub2.stop();

    expect(ticks.map((t) => t.clientRefId)).toContain("42");
    expect(sub2.lookupByClientRefId("42")).toBeDefined();
  });

  it("emits stalled after 30s of consecutive RPC 5xx failures", async () => {
    vi.useFakeTimers();
    try {
      const failingFetch = vi.fn(
        async () => new Response("upstream blew up", { status: 503 }),
      );
      const sub = new PrivateTransferSubscriber({
        rpcUrl: "http://rpc.test",
        queuePda: QUEUE,
        mint: MINT,
        receiverWallet: RECEIVER,
        pollIntervalMs: 100,
        initialWatermark: "seed",
        fetch: failingFetch as unknown as typeof fetch,
      });
      const stalls: unknown[] = [];
      sub.on("stalled", (e) => stalls.push(e));
      await sub.start();

      for (let i = 0; i < 350; i++) {
        await vi.advanceTimersByTimeAsync(100);
      }
      vi.useRealTimers();
      await sub.stop();

      expect(stalls.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop() awaits in-flight poll and aborts pending fetch", async () => {
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
      mint: MINT,
      receiverWallet: RECEIVER,
      pollIntervalMs: 5,
      initialWatermark: "seed",
      fetch: slowFetch as unknown as typeof fetch,
    });
    const errors: Error[] = [];
    const stalls: unknown[] = [];
    sub.on("error", (e) => errors.push(e));
    sub.on("stalled", (e) => stalls.push(e));
    await sub.start();
    while (!fetchStarted) await new Promise((r) => setTimeout(r, 5));

    const t0 = Date.now();
    await sub.stop(2000);
    const elapsed = Date.now() - t0;

    expect(aborted).toBe(true);
    expect(elapsed).toBeLessThan(500);
    expect(errors).toHaveLength(0);
    expect(stalls).toHaveLength(0);
  });

  it("expires tick entries after ttlMs", async () => {
    const state: RouteState = { sigs: [], txs: {} };
    const sub = makeSubscriber(state, { ttlMs: 50 });
    await sub.start();

    state.sigs = [{ signature: "sigTtl", slot: 2, err: null }];
    state.txs.sigTtl = paymentTx({
      clientRefId: "999",
      sender: "Sx",
      receiver: RECEIVER,
      amount: "9990",
    });

    const waitTick = new Promise<void>((resolve) => sub.once("tick", () => resolve()));
    await waitTick;
    expect(sub.lookupByClientRefId("999")).toBeDefined();

    await new Promise((r) => setTimeout(r, 80));
    expect(sub.lookupByClientRefId("999")).toBeUndefined();
    await sub.stop();
  });
});
