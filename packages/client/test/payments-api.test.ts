import { Keypair } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { PaymentsApi } from "../src/payments-api.js";
import { Px402ClientError } from "../src/types.js";

const MINT = "5CmxDcDtDiqwxy9TDVyo1Xjr4AFwQzrH7vKr8cXfkEse";

function buildApi(fetchMock: ReturnType<typeof vi.fn>) {
  return new PaymentsApi({
    wallet: Keypair.generate(),
    mint: MINT,
    apiUrl: "https://payments.test",
    baseRpcUrl: "https://base.test",
    ephemeralRpcUrl: "https://er.test",
    cluster: "devnet",
    visibility: "private",
    fromBalance: "base",
    toBalance: "base",
    fetch: fetchMock as unknown as typeof fetch,
  });
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("PaymentsApi request shape", () => {
  it("transfer POSTs to /v1/spl/transfer with the full documented body", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        new Response("boom", { status: 500 }),
    );
    const api = buildApi(fetchMock);
    await expect(
      api.transfer({ destination: "DEST", amount: 50n, clientRefId: "12345" }),
    ).rejects.toBeInstanceOf(Px402ClientError);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://payments.test/v1/spl/transfer");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      to: "DEST",
      amount: 50,
      mint: MINT,
      cluster: "devnet",
      visibility: "private",
      fromBalance: "base",
      toBalance: "base",
      clientRefId: "12345",
    });
    expect("initIfMissing" in body).toBe(false);
    expect(typeof body.from).toBe("string");
  });

  it("transfer omits clientRefId when not provided", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        new Response("boom", { status: 500 }),
    );
    const api = buildApi(fetchMock);
    await api.transfer({ destination: "DEST", amount: 10n }).catch(() => null);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect("clientRefId" in body).toBe(false);
  });

  it("deposit POSTs to /v1/spl/deposit with initIfMissing flags", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        new Response("boom", { status: 500 }),
    );
    const api = buildApi(fetchMock);
    await api.deposit(1_000_000n).catch(() => null);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://payments.test/v1/spl/deposit");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      amount: 1_000_000,
      mint: MINT,
      cluster: "devnet",
      initIfMissing: true,
      initVaultIfMissing: true,
    });
  });

  it("withdraw POSTs to /v1/spl/withdraw", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        new Response("boom", { status: 500 }),
    );
    const api = buildApi(fetchMock);
    await api.withdraw(500_000n).catch(() => null);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://payments.test/v1/spl/withdraw");
  });

  it("baseBalance GETs /v1/spl/balance with query params", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        okResponse({ balance: "1000000", decimals: 6 }),
    );
    const api = buildApi(fetchMock);
    const result = await api.baseBalance();
    expect(result).toMatchObject({ amount: "1000000", decimals: 6 });
    const [url] = fetchMock.mock.calls[0]!;
    const u = new URL(String(url));
    expect(u.pathname).toBe("/v1/spl/balance");
    expect(u.searchParams.get("mint")).toBe(MINT);
    expect(u.searchParams.get("cluster")).toBe("devnet");
    expect(u.searchParams.get("address")).toBeTruthy();
  });

  it("rejects zero or negative amounts before calling the API", async () => {
    const fetchMock = vi.fn();
    const api = buildApi(fetchMock);
    await expect(api.deposit(0n)).rejects.toThrow(/positive/);
    await expect(api.deposit(-5n)).rejects.toThrow(/positive/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects amounts above MAX_SAFE_INTEGER", async () => {
    const fetchMock = vi.fn();
    const api = buildApi(fetchMock);
    const tooBig = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    await expect(api.deposit(tooBig)).rejects.toThrow(/MAX_SAFE_INTEGER/);
  });

  it("private-balance runs the challenge/login handshake and attaches Bearer token", async () => {
    const fetchMock = vi.fn(
      async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/v1/spl/challenge")) {
          return okResponse({ challenge: "chal-123" });
        }
        if (url.includes("/v1/spl/login")) {
          return okResponse({ token: "jwt-xyz" });
        }
        if (url.includes("/v1/spl/private-balance")) {
          const auth = (init?.headers as Record<string, string>)?.authorization;
          if (auth !== "Bearer jwt-xyz") return new Response("no auth", { status: 401 });
          return okResponse({
            balance: "42000",
            decimals: 6,
            address: "addr",
            mint: MINT,
            ata: "ata",
            location: "ephemeral",
          });
        }
        return new Response("unexpected", { status: 404 });
      },
    );
    const api = buildApi(fetchMock);
    const res = await api.privateBalance();
    expect(res).toMatchObject({ amount: "42000", decimals: 6 });

    // Second call reuses the cached token (no second challenge request).
    await api.privateBalance();
    const challengeCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/v1/spl/challenge"),
    );
    expect(challengeCalls).toHaveLength(1);
  });
});
