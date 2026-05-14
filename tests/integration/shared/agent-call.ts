/**
 * Single-payment agent helper. Wraps Px402Client.fetch with timing + outcome
 * recording. Used by every integration test scenario.
 */
import { Keypair } from "@solana/web3.js";
import { Px402Client } from "@px402/client";
import {
  PX402_API_URL,
  PX402_BASE_RPC_URL,
  PX402_CLUSTER,
  PX402_EPHEMERAL_RPC_URL,
  PX402_USDC_MINT,
} from "./constants.js";

export interface AgentCallResult {
  status: number;
  latencyMs: number;
  paymentId?: string;
  signature?: string;
  body?: unknown;
  error?: string;
  retries: number;
}

export interface AgentCallOptions {
  /** Override the global retry schedule. */
  retryDelaysMs?: number[];
  /** Custom path. Default `/api/sentiment?token=SOL`. */
  path?: string;
  /** Custom mint. */
  mint?: string;
}

export async function runAgentCall(
  serverUrl: string,
  wallet: Keypair,
  opts: AgentCallOptions = {},
): Promise<AgentCallResult> {
  // Env-level override so the suite can fit the current devnet crank cadence
  // (~3-5min after the 2026-05-13 protocol change) without per-test edits.
  // Mainnet keeps the Px402Client default (~30s).
  const envDelays = process.env.PX402_RETRY_DELAYS_MS;
  const envDelaysMs = envDelays
    ? envDelays
        .split(",")
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0)
    : undefined;
  const retryDelaysMs = opts.retryDelaysMs ?? envDelaysMs;

  const client = new Px402Client({
    wallet,
    mint: opts.mint ?? PX402_USDC_MINT,
    apiUrl: PX402_API_URL,
    baseRpcUrl: PX402_BASE_RPC_URL,
    ephemeralRpcUrl: PX402_EPHEMERAL_RPC_URL,
    cluster: PX402_CLUSTER,
    ...(retryDelaysMs ? { retryDelaysMs } : {}),
  });

  const path = opts.path ?? "/api/sentiment?token=SOL";
  const t0 = Date.now();
  let paymentId: string | undefined;
  let signature: string | undefined;
  let retries = 0;

  try {
    const res = await client.fetch(
      `${serverUrl}${path}`,
      {},
      {
        onBeforePay: (h) => {
          paymentId = h.paymentId;
        },
        onAfterPay: (e) => {
          signature = e.signature;
        },
        onRetry: () => {
          retries += 1;
        },
      },
    );
    const latencyMs = Date.now() - t0;
    let body: unknown;
    try {
      body = await res.clone().json();
    } catch {
      body = await res.text();
    }
    return {
      status: res.status,
      latencyMs,
      ...(paymentId !== undefined ? { paymentId } : {}),
      ...(signature !== undefined ? { signature } : {}),
      body,
      retries,
    };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    return {
      status: 0,
      latencyMs,
      ...(paymentId !== undefined ? { paymentId } : {}),
      ...(signature !== undefined ? { signature } : {}),
      error: err instanceof Error ? err.message : String(err),
      retries,
    };
  }
}
