import {
  InsufficientBalanceError,
  MaxRetriesExceededError,
  PaymentRequiredError,
  Px402ClientError,
} from "./types.js";
import type { PaymentsApi } from "./payments-api.js";

/**
 * Retry schedule for the 402 -> pay -> retry flow.
 *
 * Private base->base path has three latency legs: base confirm (~1.5s),
 * TEE decrypt + queue (~sub-second), crank tick (~500ms after cranker is
 * registered). We give the crank a couple of cycles to land before backing
 * off aggressively.
 */
const DEFAULT_RETRY_DELAYS_MS = [2000, 4000, 8000, 15000] as const;

interface Headers402 {
  amount: string;
  currency: string;
  network: string;
  destination: string;
  paymentId: string;
  token: string;
}

export interface FetchDeps {
  api: PaymentsApi;
  fetch: typeof fetch;
  retryDelaysMs: number[];
  onBeforePay?: (h: Headers402) => void;
  onAfterPay?: (h: Headers402 & { signature: string }) => void;
  onRetry?: (attempt: number, delayMs: number, error?: string) => void;
}

/**
 * Wrap any fetch-like call with 402 handling. On a 402 response this reads the
 * X-Payment-* headers, issues a private PER transfer with memo=paymentId, and
 * retries with the locked-design backoff schedule. An expired token triggers a
 * fresh 402 exchange.
 */
export async function fetchWithPayment(
  url: string | URL,
  init: RequestInit,
  deps: FetchDeps,
): Promise<Response> {
  const first = await deps.fetch(url, init);
  if (first.status !== 402) return first;

  return payAndRetry(url, init, first, deps, /* attempt */ 0);
}

async function payAndRetry(
  url: string | URL,
  init: RequestInit,
  res402: Response,
  deps: FetchDeps,
  attempt: number,
): Promise<Response> {
  if (attempt > 2) {
    throw new MaxRetriesExceededError("exchanged too many fresh payment ids");
  }

  const headers = extractHeaders(res402);
  deps.onBeforePay?.(headers);

  let signature: string;
  try {
    signature = await deps.api.transfer({
      destination: headers.destination,
      amount: BigInt(headers.amount),
      clientRefId: headers.paymentId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    if (msg.includes("insufficient")) {
      throw new InsufficientBalanceError(headers.amount, "unknown");
    }
    throw err;
  }
  deps.onAfterPay?.({ ...headers, signature });

  for (let i = 0; i < deps.retryDelaysMs.length; i++) {
    const delay = deps.retryDelaysMs[i]!;
    await sleep(delay);
    const retryRes = await deps.fetch(url, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        "X-Payment-Id": headers.paymentId,
        "X-Payment-Token": headers.token,
      },
    });
    if (retryRes.status === 200) return retryRes;

    if (retryRes.status === 402) {
      const body = (await retryRes.clone().json().catch(() => ({}))) as {
        error?: string;
        reason?: string;
      };
      // Token expired mid-retry: swap in a fresh payment_id from the new 402.
      if (body.reason === "expired") {
        return payAndRetry(url, init, retryRes, deps, attempt + 1);
      }
      deps.onRetry?.(i + 1, delay, body.error ?? "pending");
      continue;
    }

    const text = await retryRes.text();
    throw new Px402ClientError(
      `retry returned ${retryRes.status}: ${text}`,
      "UNEXPECTED_STATUS",
    );
  }

  throw new MaxRetriesExceededError();
}

function extractHeaders(res: Response): Headers402 {
  const h = (name: string) => res.headers.get(name);
  const required = (name: string): string => {
    const v = h(name);
    if (!v) throw new PaymentRequiredError(`missing ${name} header on 402`);
    return v;
  };
  return {
    amount: required("x-payment-amount"),
    currency: required("x-payment-currency"),
    network: required("x-payment-network"),
    destination: required("x-payment-address"),
    paymentId: required("x-payment-id"),
    token: required("x-payment-token"),
  };
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export { DEFAULT_RETRY_DELAYS_MS };
