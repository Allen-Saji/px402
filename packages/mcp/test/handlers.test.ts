import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  fetchInputSchema,
  handleBalance,
  handleFetch,
  type Px402ClientLike,
} from "../src/server.js";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function mockClient(opts: {
  fetch?: Px402ClientLike["fetch"];
  balance?: Px402ClientLike["balance"];
}): Px402ClientLike {
  return {
    fetch: opts.fetch ?? (async () => new Response("not stubbed", { status: 500 })),
    balance: opts.balance ?? (async () => ({ amount: "0", decimals: 6 })),
  };
}

describe("handleFetch", () => {
  it("wraps a 200 JSON response in the documented envelope", async () => {
    const client = mockClient({
      fetch: async () =>
        new Response(JSON.stringify({ sentiment: "bullish" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-payment-signature": "sigABC",
          },
        }),
    });
    const result = await handleFetch(client, { url: "http://demo.test/api/sentiment" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
    const envelope = JSON.parse(result.content[0]!.text) as {
      status: number;
      signature: string | null;
      body: unknown;
    };
    expect(envelope).toEqual({
      status: 200,
      signature: "sigABC",
      body: { sentiment: "bullish" },
    });
  });

  it("returns body as raw string when response is not JSON", async () => {
    const client = mockClient({
      fetch: async () => new Response("not json at all", { status: 200 }),
    });
    const result = await handleFetch(client, { url: "http://demo.test/api/text" });
    const envelope = JSON.parse(result.content[0]!.text) as { body: unknown };
    expect(envelope.body).toBe("not json at all");
  });

  it("signature is null when X-Payment-Signature header is absent", async () => {
    const client = mockClient({
      fetch: async () => jsonResponse({ ok: true }),
    });
    const result = await handleFetch(client, { url: "http://demo.test/api/free" });
    const envelope = JSON.parse(result.content[0]!.text) as { signature: string | null };
    expect(envelope.signature).toBeNull();
  });

  it("propagates non-2xx status into the envelope without throwing", async () => {
    const client = mockClient({
      fetch: async () => new Response("rate limited", { status: 429 }),
    });
    const result = await handleFetch(client, { url: "http://demo.test/api/sentiment" });
    const envelope = JSON.parse(result.content[0]!.text) as { status: number };
    expect(envelope.status).toBe(429);
  });

  it("forwards method, headers, and body to client.fetch", async () => {
    let capturedUrl: string | URL | null = null;
    let capturedInit: RequestInit | undefined;
    const client = mockClient({
      fetch: async (url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return jsonResponse({ ok: true });
      },
    });
    await handleFetch(client, {
      url: "http://demo.test/api/echo",
      method: "POST",
      headers: { "x-trace": "abc" },
      body: JSON.stringify({ hi: "there" }),
    });
    expect(capturedUrl).toBe("http://demo.test/api/echo");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toEqual({ "x-trace": "abc" });
    expect(capturedInit?.body).toBe(JSON.stringify({ hi: "there" }));
  });

  it("defaults to GET when method is omitted", async () => {
    let capturedMethod: string | undefined;
    const client = mockClient({
      fetch: async (_url, init) => {
        capturedMethod = init?.method;
        return jsonResponse({ ok: true });
      },
    });
    await handleFetch(client, { url: "http://demo.test/api/sentiment" });
    expect(capturedMethod).toBe("GET");
  });

  it("surfaces client errors to the caller (insufficient balance, etc.)", async () => {
    const client = mockClient({
      fetch: async () => {
        throw new Error("InsufficientBalanceError: 100 < 200");
      },
    });
    await expect(handleFetch(client, { url: "http://demo.test/api/sentiment" })).rejects.toThrow(
      /InsufficientBalanceError/,
    );
  });
});

describe("handleBalance", () => {
  it("returns the BalanceResponse envelope verbatim", async () => {
    const client = mockClient({
      balance: async () => ({ amount: "12345678", decimals: 6 }),
    });
    const result = await handleBalance(client);
    expect(result.content).toHaveLength(1);
    const envelope = JSON.parse(result.content[0]!.text) as {
      amount: string;
      decimals?: number;
    };
    expect(envelope.amount).toBe("12345678");
    expect(envelope.decimals).toBe(6);
  });

  it("omits decimals gracefully when MagicBlock didn't return it", async () => {
    const client = mockClient({
      balance: async () => ({ amount: "1000000" }),
    });
    const result = await handleBalance(client);
    const envelope = JSON.parse(result.content[0]!.text) as { amount: string; decimals?: number };
    expect(envelope.amount).toBe("1000000");
    expect(envelope.decimals).toBeUndefined();
  });

  it("propagates RPC errors to the caller", async () => {
    const client = mockClient({
      balance: async () => {
        throw new Error("RPC timeout");
      },
    });
    await expect(handleBalance(client)).rejects.toThrow(/RPC timeout/);
  });
});

describe("fetchInputSchema", () => {
  const schema = z.object(fetchInputSchema);

  it("accepts a minimal valid input", () => {
    const parsed = schema.parse({ url: "https://demo.test/api/sentiment" });
    expect(parsed.url).toBe("https://demo.test/api/sentiment");
    expect(parsed.method).toBe("GET");
  });

  it("rejects non-URL strings", () => {
    expect(() => schema.parse({ url: "not-a-url" })).toThrow();
  });

  it("rejects unsupported HTTP methods", () => {
    expect(() =>
      schema.parse({ url: "https://demo.test/api/sentiment", method: "TRACE" }),
    ).toThrow();
  });

  it("accepts headers as a string record", () => {
    const parsed = schema.parse({
      url: "https://demo.test/api/echo",
      method: "POST",
      headers: { "x-trace": "abc" },
    });
    expect(parsed.headers).toEqual({ "x-trace": "abc" });
  });

  it("rejects headers with non-string values", () => {
    expect(() =>
      schema.parse({
        url: "https://demo.test/api/echo",
        headers: { "x-num": 42 as unknown as string },
      }),
    ).toThrow();
  });
});
