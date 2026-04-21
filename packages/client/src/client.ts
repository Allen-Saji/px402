import { PaymentsApi } from "./payments-api.js";
import {
  DEFAULT_RETRY_DELAYS_MS,
  fetchWithPayment,
  type FetchDeps,
} from "./fetch.js";
import type { BalanceResponse, Px402ClientConfig } from "./types.js";

const DEFAULTS = {
  apiUrl: "https://payments.magicblock.app",
  baseRpcUrl: "https://rpc.magicblock.app/devnet",
  ephemeralRpcUrl: "https://devnet.magicblock.app",
  cluster: "devnet" as const,
  privacy: "private" as const,
};

export class Px402Client {
  private readonly api: PaymentsApi;
  private readonly retryDelaysMs: number[];
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: Px402ClientConfig) {
    this.fetchImpl = cfg.fetch ?? fetch;
    this.retryDelaysMs = cfg.retryDelaysMs ?? Array.from(DEFAULT_RETRY_DELAYS_MS);
    this.api = new PaymentsApi({
      wallet: cfg.wallet,
      mint: cfg.mint,
      apiUrl: cfg.apiUrl ?? DEFAULTS.apiUrl,
      baseRpcUrl: cfg.baseRpcUrl ?? DEFAULTS.baseRpcUrl,
      ephemeralRpcUrl: cfg.ephemeralRpcUrl ?? DEFAULTS.ephemeralRpcUrl,
      cluster: cfg.cluster ?? DEFAULTS.cluster,
      privacy: cfg.privacy ?? DEFAULTS.privacy,
      fetch: this.fetchImpl,
    });
  }

  /** Move SPL tokens from the base chain into the PER. */
  deposit(amount: bigint): Promise<string> {
    return this.api.deposit(amount);
  }

  /** Move SPL tokens out of the PER back to the base chain. */
  withdraw(amount: bigint): Promise<string> {
    return this.api.withdraw(amount);
  }

  /** Base-chain SPL balance. */
  balance(): Promise<BalanceResponse> {
    return this.api.baseBalance();
  }

  /**
   * Ephemeral rollup (PER) SPL balance. This is what gets spent on 402 calls.
   *
   * NOTE: As of 2026-04-21 the live devnet endpoint returns 422 with
   * `authorization is required`. The MagicBlock SDK obtains a signed-challenge
   * token via `getAuthToken`. Integrating that flow here is tracked as a
   * follow-up and blocks full PER balance reads until resolved.
   */
  privateBalance(): Promise<BalanceResponse> {
    return this.api.privateBalance();
  }

  /**
   * Issue a private PER transfer directly. Useful for non-HTTP flows or agent
   * tooling that wants to prepay and hand off the payment id/token.
   */
  transfer(opts: {
    destination: string;
    amount: bigint;
    memo?: string;
  }): Promise<string> {
    return this.api.transfer(opts);
  }

  /**
   * `fetch` wrapper with automatic 402 handling. Drop-in replacement for any
   * endpoint gated by @px402/hono, @px402/express, or @px402/next.
   */
  fetch(
    url: string | URL,
    init: RequestInit = {},
    hooks: Pick<FetchDeps, "onBeforePay" | "onAfterPay" | "onRetry"> = {},
  ): Promise<Response> {
    return fetchWithPayment(url, init, {
      api: this.api,
      fetch: this.fetchImpl,
      retryDelaysMs: this.retryDelaysMs,
      ...hooks,
    });
  }
}
