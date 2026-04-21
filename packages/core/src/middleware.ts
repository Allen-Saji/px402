import {
  ExpiredTokenError,
  InvalidTokenError,
  type PaymentTokenPayload,
  type Px402CoreConfig,
  type VerifyOutcome,
} from "./types.js";
import { RateLimiter, type LimitDecision } from "./rate-limit.js";
import { createPaymentToken, verifyPaymentToken } from "./token.js";
import { verifyPayment, type VerifierDeps } from "./verify.js";

const DEFAULT_NETWORK = "solana-per";
const DEFAULT_CURRENCY = "USDC";

/** Framework-agnostic request context fed into `decide`. */
export interface RequestContext {
  /** Normalized path (no query string, no trailing slash). */
  path: string;
  /** Client IP, for rate limiting. */
  ip: string;
  /** X-Payment-Id header value, if present. */
  paymentId?: string;
  /** X-Payment-Token header value, if present. */
  paymentToken?: string;
}

/** Config the shared `decide` function needs. Must extend Px402CoreConfig. */
export interface HandlerConfig extends Px402CoreConfig {
  /** Server's wallet pubkey (X-Payment-Address + `to` on /v1/spl/transfer). */
  paymentAddress: string;
  /** Subscriber indexed by clientRefId. */
  subscriber: VerifierDeps;
  /** Default: "solana-per". */
  network?: string;
  /** Default: "USDC". */
  currency?: string;
  /** Hook fired whenever a request is verified. */
  onVerified?: (event: VerifiedEvent) => void;
}

export interface VerifiedEvent {
  payload: PaymentTokenPayload;
  signature: string;
  amount: string;
  path: string;
  ip: string;
}

export type Decision =
  | {
      kind: "next";
      /** Signature of the verified transfer. Adapters can surface this as a response header. */
      signature: string;
      amount: string;
      payload: PaymentTokenPayload;
    }
  | {
      kind: "respond";
      status: number;
      headers: Record<string, string>;
      body: unknown;
    };

export interface Px402Handler {
  decide(req: RequestContext): Decision;
}

/**
 * Build a framework-agnostic px402 request handler. A single RateLimiter is
 * created per handler so limits persist across requests; adapters instantiate
 * one handler at startup and call `decide` per request.
 */
export function createHandler(config: HandlerConfig): Px402Handler {
  const limiter = new RateLimiter(config.rateLimit ?? {});
  const network = config.network ?? DEFAULT_NETWORK;
  const currency = config.currency ?? DEFAULT_CURRENCY;
  const paymentAddress = config.paymentAddress;

  return {
    decide(req) {
      const price = config.pricing[req.path];
      // Unpriced paths: pass through.
      if (!price) return { kind: "next", signature: "", amount: "0", payload: emptyPayload() };

      if (!req.paymentId || !req.paymentToken) {
        const gate = limiter.checkIssue(req.ip);
        if (!gate.ok) return rateLimited(gate);
        return issue402({ amount: price, paymentAddress, path: req.path, network, currency, config });
      }

      let payload: PaymentTokenPayload;
      try {
        payload = verifyPaymentToken(config, req.paymentToken);
      } catch (err) {
        if (err instanceof ExpiredTokenError) {
          const gate = limiter.checkIssue(req.ip);
          if (!gate.ok) return rateLimited(gate);
          return issue402({
            amount: price,
            paymentAddress,
            path: req.path,
            network,
            currency,
            config,
            reason: "expired",
          });
        }
        if (err instanceof InvalidTokenError) {
          return respondJson(401, { error: "invalid_token" });
        }
        throw err;
      }

      if (payload.paymentId !== req.paymentId) return respondJson(401, { error: "payment_id_mismatch" });
      if (payload.path !== req.path) return respondJson(401, { error: "path_mismatch" });
      if (payload.amount !== price) return respondJson(401, { error: "amount_changed" });
      if (payload.destination !== paymentAddress) return respondJson(401, { error: "destination_mismatch" });

      const gate = limiter.checkVerify(payload.paymentId);
      if (!gate.ok) return rateLimited(gate);

      const outcome: VerifyOutcome = verifyPayment(config.subscriber, payload);
      return translateVerify(outcome, payload, req, config);
    },
  };
}

function translateVerify(
  outcome: VerifyOutcome,
  payload: PaymentTokenPayload,
  req: RequestContext,
  config: HandlerConfig,
): Decision {
  switch (outcome.status) {
    case "verified":
      config.onVerified?.({
        payload,
        signature: outcome.signature,
        amount: outcome.amount,
        path: req.path,
        ip: req.ip,
      });
      return { kind: "next", signature: outcome.signature, amount: outcome.amount, payload };
    case "pending":
      return respondJson(402, { error: "payment_pending" });
    case "amount_mismatch":
      return respondJson(402, {
        error: "amount_mismatch",
        expected: outcome.expected,
        actual: outcome.actual,
      });
    case "replay":
      return respondJson(409, { error: "replay" });
    case "rpc_error":
      return respondJson(503, { error: "rpc_error", detail: outcome.error });
    default: {
      const _exhaustive: never = outcome;
      void _exhaustive;
      return respondJson(500, { error: "unknown" });
    }
  }
}

interface Issue402Input {
  amount: string;
  paymentAddress: string;
  path: string;
  network: string;
  currency: string;
  config: HandlerConfig;
  reason?: string;
}

function issue402(input: Issue402Input): Decision {
  const { paymentId, token, expiry } = createPaymentToken(input.config, {
    path: input.path,
    destination: input.paymentAddress,
    amount: input.amount,
  });
  return {
    kind: "respond",
    status: 402,
    headers: {
      "X-Payment-Amount": input.amount,
      "X-Payment-Currency": input.currency,
      "X-Payment-Network": input.network,
      "X-Payment-Address": input.paymentAddress,
      "X-Payment-Id": paymentId,
      "X-Payment-Token": token,
    },
    body: {
      error: "payment_required",
      reason: input.reason ?? "initial",
      amount: input.amount,
      currency: input.currency,
      network: input.network,
      destination: input.paymentAddress,
      paymentId,
      expiry,
    },
  };
}

function rateLimited(gate: LimitDecision): Decision {
  return {
    kind: "respond",
    status: 429,
    headers: { "Retry-After": Math.ceil(gate.retryAfterMs / 1000).toString() },
    body: { error: "rate_limited" },
  };
}

function respondJson(status: number, body: unknown, headers: Record<string, string> = {}): Decision {
  return { kind: "respond", status, headers, body };
}

function emptyPayload(): PaymentTokenPayload {
  return { paymentId: "", amount: "0", expiry: 0, path: "", destination: "" };
}

/**
 * Normalize a raw HTTP path: strip the query string and trailing slash.
 * Exposed so adapters use the same rules the handler does.
 */
export function normalizePath(p: string): string {
  const trimmed = p.split("?")[0] ?? p;
  if (trimmed.length > 1 && trimmed.endsWith("/")) return trimmed.slice(0, -1);
  return trimmed;
}
