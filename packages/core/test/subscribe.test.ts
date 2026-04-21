import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerSubscriber } from "../src/subscribe.js";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";

const USDC_ATA = "3PkQ4JM6WWWEpxoaQtFczYgn47ZkMmdFWySSBfGVVh6v";

function makeNotification(signature: string, memo: string | null) {
  const logs: string[] = [
    "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]",
    "Program log: Instruction: TransferChecked",
  ];
  if (memo !== null) {
    logs.push("Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr invoke [1]");
    logs.push(`Program log: Memo (len ${memo.length}): "${memo}"`);
  }
  return {
    jsonrpc: "2.0",
    method: "logsNotification",
    params: {
      result: {
        context: { slot: 1 },
        value: { signature, err: null, logs },
      },
      subscription: 42,
    },
  };
}

interface MockServer {
  url: string;
  close: () => Promise<void>;
  broadcast: (msg: unknown) => void;
  requests: unknown[];
}

async function startMockRpc(): Promise<MockServer> {
  const wss = new WebSocketServer({ port: 0 });
  const requests: unknown[] = [];
  const clients = new Set<import("ws").WebSocket>();

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("message", (raw) => {
      const parsed = JSON.parse(raw.toString());
      requests.push(parsed);
      if (parsed.method === "logsSubscribe") {
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: 42 }));
      }
    });
    ws.on("close", () => clients.delete(ws));
  });

  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
  const port = (wss.address() as AddressInfo).port;

  return {
    url: `ws://127.0.0.1:${port}`,
    broadcast: (msg) => {
      for (const c of clients) c.send(JSON.stringify(msg));
    },
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of clients) c.terminate();
        wss.close(() => resolve());
      }),
  };
}

describe("PerSubscriber", () => {
  let server: MockServer;
  let sub: PerSubscriber | null = null;

  beforeEach(async () => {
    server = await startMockRpc();
  });
  afterEach(async () => {
    sub?.stop();
    sub = null;
    await server.close();
  });

  it("subscribes, extracts memo, and stores signature+amount", async () => {
    const fetchAmount = vi.fn(async (_sig: string) => "10000");
    sub = new PerSubscriber({
      wsUrl: server.url,
      destination: USDC_ATA,
      fetchAmount,
    });
    await sub.start();

    // Server should have received a logsSubscribe request.
    const req = server.requests[0] as { method: string; params: unknown[] };
    expect(req.method).toBe("logsSubscribe");

    const memoReceived = new Promise<void>((resolve) => sub!.once("memo", () => resolve()));
    server.broadcast(makeNotification("sigABC", "01JN8K7MXZABCDEFGHJKMN0001"));
    await memoReceived;

    const hit = sub.lookupByMemo("01JN8K7MXZABCDEFGHJKMN0001");
    expect(hit).toEqual({ signature: "sigABC", amount: "10000" });
    expect(fetchAmount).toHaveBeenCalledWith("sigABC");
  });

  it("ignores notifications without a memo log", async () => {
    const fetchAmount = vi.fn(async () => "10000");
    sub = new PerSubscriber({
      wsUrl: server.url,
      destination: USDC_ATA,
      fetchAmount,
    });
    await sub.start();

    server.broadcast(makeNotification("sigABC", null));
    // Give any async resolveAmount a tick.
    await new Promise((r) => setTimeout(r, 20));

    expect(fetchAmount).not.toHaveBeenCalled();
  });

  it("skips entry when fetchAmount returns null", async () => {
    const fetchAmount = vi.fn(async () => null);
    sub = new PerSubscriber({
      wsUrl: server.url,
      destination: USDC_ATA,
      fetchAmount,
    });
    await sub.start();

    server.broadcast(makeNotification("sigABC", "01JN8K7MXZABCDEFGHJKMN0001"));
    await new Promise((r) => setTimeout(r, 20));

    expect(sub.lookupByMemo("01JN8K7MXZABCDEFGHJKMN0001")).toBeUndefined();
  });

  it("markSignatureUsed returns false on second call", async () => {
    const fetchAmount = vi.fn(async () => "10000");
    sub = new PerSubscriber({
      wsUrl: server.url,
      destination: USDC_ATA,
      fetchAmount,
    });
    await sub.start();

    expect(sub.markSignatureUsed("sig1")).toBe(true);
    expect(sub.markSignatureUsed("sig1")).toBe(false);
  });

  it("expires memo entries after ttlMs", async () => {
    const fetchAmount = vi.fn(async () => "10000");
    sub = new PerSubscriber({
      wsUrl: server.url,
      destination: USDC_ATA,
      fetchAmount,
      ttlMs: 50,
    });
    await sub.start();

    const memoReceived = new Promise<void>((resolve) => sub!.once("memo", () => resolve()));
    server.broadcast(makeNotification("sigABC", "01JN8K7MXZABCDEFGHJKMN0001"));
    await memoReceived;

    expect(sub.lookupByMemo("01JN8K7MXZABCDEFGHJKMN0001")).toBeDefined();
    await new Promise((r) => setTimeout(r, 80));
    expect(sub.lookupByMemo("01JN8K7MXZABCDEFGHJKMN0001")).toBeUndefined();
  });
});
