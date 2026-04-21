import { describe, expect, it, vi } from "vitest";
import { createFetchAmount } from "../src/fetch-amount.js";

const MINT = "5CmxDcDtDiqwxy9TDVyo1Xjr4AFwQzrH7vKr8cXfkEse";
const OWNER = "3wBhCBpCudbtfdaGdBRWhjsRq9B2yAkAgKadjJkVdAiA";
const RPC = "https://devnet.magicblock.app";

function mockResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeTx(opts: {
  err?: unknown;
  pre?: { accountIndex: number; mint: string; owner: string; amount: string }[];
  post?: { accountIndex: number; mint: string; owner: string; amount: string }[];
}) {
  return {
    jsonrpc: "2.0" as const,
    id: 1,
    result: {
      slot: 1,
      meta: {
        err: opts.err ?? null,
        preTokenBalances: opts.pre?.map((b) => ({
          accountIndex: b.accountIndex,
          mint: b.mint,
          owner: b.owner,
          uiTokenAmount: { amount: b.amount, decimals: 6 },
        })),
        postTokenBalances: opts.post?.map((b) => ({
          accountIndex: b.accountIndex,
          mint: b.mint,
          owner: b.owner,
          uiTokenAmount: { amount: b.amount, decimals: 6 },
        })),
      },
    },
  };
}

describe("createFetchAmount", () => {
  it("returns the delta for matching mint + owner", async () => {
    const mockFetch = vi.fn(async () =>
      mockResponse(
        makeTx({
          pre: [{ accountIndex: 1, mint: MINT, owner: OWNER, amount: "1000" }],
          post: [{ accountIndex: 1, mint: MINT, owner: OWNER, amount: "11000" }],
        }),
      ),
    );
    const f = createFetchAmount({
      rpcUrl: RPC,
      destinationOwner: OWNER,
      mint: MINT,
      fetch: mockFetch as unknown as typeof fetch,
    });
    expect(await f("sigABC")).toBe("10000");
  });

  it("handles missing preTokenBalance (first-deposit case)", async () => {
    const mockFetch = vi.fn(async () =>
      mockResponse(
        makeTx({
          pre: [],
          post: [{ accountIndex: 2, mint: MINT, owner: OWNER, amount: "50000" }],
        }),
      ),
    );
    const f = createFetchAmount({
      rpcUrl: RPC,
      destinationOwner: OWNER,
      mint: MINT,
      fetch: mockFetch as unknown as typeof fetch,
    });
    expect(await f("sigABC")).toBe("50000");
  });

  it("returns null for other-mint transfer", async () => {
    const otherMint = "SomeOtherMintAddressXXXXXXXXXXXXXXXXXXXXXXX";
    const mockFetch = vi.fn(async () =>
      mockResponse(
        makeTx({
          pre: [{ accountIndex: 1, mint: otherMint, owner: OWNER, amount: "0" }],
          post: [{ accountIndex: 1, mint: otherMint, owner: OWNER, amount: "100" }],
        }),
      ),
    );
    const f = createFetchAmount({
      rpcUrl: RPC,
      destinationOwner: OWNER,
      mint: MINT,
      fetch: mockFetch as unknown as typeof fetch,
    });
    expect(await f("sigABC")).toBeNull();
  });

  it("returns null for other-owner recipient", async () => {
    const otherOwner = "OtherWalletXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
    const mockFetch = vi.fn(async () =>
      mockResponse(
        makeTx({
          pre: [],
          post: [{ accountIndex: 1, mint: MINT, owner: otherOwner, amount: "100" }],
        }),
      ),
    );
    const f = createFetchAmount({
      rpcUrl: RPC,
      destinationOwner: OWNER,
      mint: MINT,
      fetch: mockFetch as unknown as typeof fetch,
    });
    expect(await f("sigABC")).toBeNull();
  });

  it("returns null when tx failed", async () => {
    const mockFetch = vi.fn(async () =>
      mockResponse(
        makeTx({
          err: { InstructionError: [0, "Custom"] },
          post: [{ accountIndex: 1, mint: MINT, owner: OWNER, amount: "100" }],
        }),
      ),
    );
    const f = createFetchAmount({
      rpcUrl: RPC,
      destinationOwner: OWNER,
      mint: MINT,
      fetch: mockFetch as unknown as typeof fetch,
    });
    expect(await f("sigABC")).toBeNull();
  });

  it("returns null when result is null (tx not found)", async () => {
    const mockFetch = vi.fn(async () =>
      mockResponse({ jsonrpc: "2.0", id: 1, result: null }),
    );
    const f = createFetchAmount({
      rpcUrl: RPC,
      destinationOwner: OWNER,
      mint: MINT,
      fetch: mockFetch as unknown as typeof fetch,
    });
    expect(await f("sigABC")).toBeNull();
  });

  it("throws on RPC error", async () => {
    const mockFetch = vi.fn(async () =>
      mockResponse({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32603, message: "internal" },
      }),
    );
    const f = createFetchAmount({
      rpcUrl: RPC,
      destinationOwner: OWNER,
      mint: MINT,
      fetch: mockFetch as unknown as typeof fetch,
    });
    await expect(f("sigABC")).rejects.toThrow(/internal/);
  });

  it("uses finalized commitment by default", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const mockFetch = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init ? { init } : {}) });
      return mockResponse(makeTx({ post: [] }));
    }) as unknown as typeof fetch;

    const f = createFetchAmount({
      rpcUrl: RPC,
      destinationOwner: OWNER,
      mint: MINT,
      fetch: mockFetch,
    });
    await f("sigABC");
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.params[1].commitment).toBe("finalized");
  });
});
