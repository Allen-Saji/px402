import { describe, expect, it, vi } from "vitest";
import { fetchWithPayment } from "../src/fetch.js";
import {
  MaxRetriesExceededError,
  PaymentRequiredError,
} from "../src/types.js";
import type { PaymentsApi } from "../src/payments-api.js";

const DEST = "3PkQ4JM6WWWEpxoaQtFczYgn47ZkMmdFWySSBfGVVh6v";
const PRICE = "10000";

function makeApi(overrides: Partial<PaymentsApi> = {}): PaymentsApi {
  return {
    transfer: vi.fn(async () => "sig-mock-12345"),
    ...overrides,
  } as unknown as PaymentsApi;
}

function header402(paymentId: string, token: string): Headers {
  const h = new Headers();
  h.set("X-Payment-Amount", PRICE);
  h.set("X-Payment-Currency", "USDC");
  h.set("X-Payment-Network", "solana-per");
  h.set("X-Payment-Address", DEST);
  h.set("X-Payment-Id", paymentId);
  h.set("X-Payment-Token", token);
  return h;
}

function mk402(paymentId = "01ABCDEFGHJKMNPQRSTVWXYZ00", token = "v1.payload.sig", body: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({ error: "payment_required", paymentId, ...body }),
    { status: 402, headers: header402(paymentId, token) },
  );
}

function mkExpired402(paymentId = "01FRESHFRESHFRESH00000FRES", token = "v1.fresh.sig"): Response {
  return new Response(
    JSON.stringify({ error: "payment_required", reason: "expired", paymentId }),
    { status: 402, headers: header402(paymentId, token) },
  );
}

function mk200(data: unknown = { ok: true }): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchWithPayment", () => {
  it("passes 200 responses through unchanged", async () => {
    const fetchMock = vi.fn(async () => mk200({ signal: "bullish" }));
    const api = makeApi();
    const res = await fetchWithPayment("http://test/api", {}, {
      api,
      fetch: fetchMock as unknown as typeof fetch,
      retryDelaysMs: [10, 20, 40],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signal: "bullish" });
    expect(api.transfer).not.toHaveBeenCalled();
  });

  it("pays on 402 and returns 200 on first retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mk402("01MEMOXXXXXXXXXXXXXXXXXXXX", "tok1"))
      .mockResolvedValueOnce(mk200({ data: "sentiment" }));
    const api = makeApi();
    const res = await fetchWithPayment("http://test/api", {}, {
      api,
      fetch: fetchMock as unknown as typeof fetch,
      retryDelaysMs: [10],
    });
    expect(res.status).toBe(200);
    expect(api.transfer).toHaveBeenCalledWith({
      destination: DEST,
      amount: BigInt(PRICE),
      clientRefId: "01MEMOXXXXXXXXXXXXXXXXXXXX",
    });

    // Second call carried the headers.
    const call2 = fetchMock.mock.calls[1]!;
    const init = call2[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Payment-Id"]).toBe("01MEMOXXXXXXXXXXXXXXXXXXXX");
    expect(headers["X-Payment-Token"]).toBe("tok1");
  });

  it("retries across the pending backoff and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mk402("01PENDMEMOXXXXXXXXXXXXXXXX", "tok2"))
      .mockResolvedValueOnce(mk402("01PENDMEMOXXXXXXXXXXXXXXXX", "tok2", { error: "payment_pending" }))
      .mockResolvedValueOnce(mk402("01PENDMEMOXXXXXXXXXXXXXXXX", "tok2", { error: "payment_pending" }))
      .mockResolvedValueOnce(mk200({ k: "v" }));
    const onRetry = vi.fn();
    const res = await fetchWithPayment("http://test/api", {}, {
      api: makeApi(),
      fetch: fetchMock as unknown as typeof fetch,
      retryDelaysMs: [5, 10, 20],
      onRetry,
    });
    expect(res.status).toBe(200);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("rolls payment_id on expired 402 and retries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mk402("01STALEXXXXXXXXXXXXXXXXXXX", "stale-tok"))
      .mockResolvedValueOnce(mkExpired402("01FRESHXXXXXXXXXXXXXXXXXXX", "fresh-tok"))
      .mockResolvedValueOnce(mk200());
    const api = makeApi();
    const res = await fetchWithPayment("http://test/api", {}, {
      api,
      fetch: fetchMock as unknown as typeof fetch,
      retryDelaysMs: [5],
    });
    expect(res.status).toBe(200);
    expect(api.transfer).toHaveBeenCalledTimes(2);
    // Second transfer uses the fresh memo.
    const secondCall = (api.transfer as ReturnType<typeof vi.fn>).mock.calls[1]![0];
    expect(secondCall.clientRefId).toBe("01FRESHXXXXXXXXXXXXXXXXXXX");
  });

  it("throws MaxRetriesExceededError when all attempts stay pending", async () => {
    const fetchMock = vi.fn(async () =>
      mk402("01PEND", "tok", { error: "payment_pending" }),
    );
    await expect(
      fetchWithPayment(
        "http://test/api",
        {},
        {
          api: makeApi(),
          fetch: fetchMock as unknown as typeof fetch,
          retryDelaysMs: [5, 5, 5],
        },
      ),
    ).rejects.toBeInstanceOf(MaxRetriesExceededError);
  });

  it("throws PaymentRequiredError when 402 is missing headers", async () => {
    const res = new Response(JSON.stringify({ error: "no" }), { status: 402 });
    const fetchMock = vi.fn(async () => res);
    await expect(
      fetchWithPayment(
        "http://test/api",
        {},
        {
          api: makeApi(),
          fetch: fetchMock as unknown as typeof fetch,
          retryDelaysMs: [5],
        },
      ),
    ).rejects.toBeInstanceOf(PaymentRequiredError);
  });

  it("fires onBeforePay and onAfterPay hooks", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mk402("01HOOKXXXXXXXXXXXXXXXXXXXXXX", "hooktok"))
      .mockResolvedValueOnce(mk200());
    const onBeforePay = vi.fn();
    const onAfterPay = vi.fn();
    await fetchWithPayment("http://test/api", {}, {
      api: makeApi(),
      fetch: fetchMock as unknown as typeof fetch,
      retryDelaysMs: [5],
      onBeforePay,
      onAfterPay,
    });
    expect(onBeforePay).toHaveBeenCalledOnce();
    expect(onAfterPay).toHaveBeenCalledOnce();
    const afterArg = onAfterPay.mock.calls[0]![0];
    expect(afterArg.signature).toBe("sig-mock-12345");
  });

  it("aborts with MaxRetriesExceededError after too many fresh-id rolls", async () => {
    const fetchMock = vi.fn(async () =>
      mkExpired402("01LOOPXXXXXXXXXXXXXXXXXXX", "looptok"),
    );
    await expect(
      fetchWithPayment(
        "http://test/api",
        {},
        {
          api: makeApi(),
          fetch: fetchMock as unknown as typeof fetch,
          retryDelaysMs: [5],
        },
      ),
    ).rejects.toBeInstanceOf(MaxRetriesExceededError);
  });
});
