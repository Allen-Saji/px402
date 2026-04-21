import {
  ExpiredTokenError,
  InvalidTokenError,
  RateLimiter,
  createPaymentToken,
  verifyPayment,
  verifyPaymentToken,
} from "@px402/core";
import type { MiddlewareHandler } from "hono";
import type { Px402HonoConfig } from "./types.js";

const DEFAULT_NETWORK = "solana-per";
const DEFAULT_CURRENCY = "USDC";

const HEADER_AMOUNT = "x-payment-amount";
const HEADER_CURRENCY = "x-payment-currency";
const HEADER_NETWORK = "x-payment-network";
const HEADER_ADDRESS = "x-payment-address";
const HEADER_PAYMENT_ID = "x-payment-id";
const HEADER_PAYMENT_TOKEN = "x-payment-token";

export function px402(config: Px402HonoConfig): MiddlewareHandler {
  const limiter = new RateLimiter(config.rateLimit ?? {});
  const network = config.network ?? DEFAULT_NETWORK;
  const currency = config.currency ?? DEFAULT_CURRENCY;

  return async (c, next) => {
    const path = normalizePath(c.req.path);
    const price = config.pricing[path];

    // Paths without a configured price are free.
    if (!price) return next();

    const paymentId = c.req.header(HEADER_PAYMENT_ID);
    const paymentToken = c.req.header(HEADER_PAYMENT_TOKEN);
    const ip = clientIp(c);

    if (!paymentId || !paymentToken) {
      const gate = limiter.checkIssue(ip);
      if (!gate.ok) return rateLimited(c, gate.retryAfterMs);
      return issue402(c, {
        amount: price,
        destination: config.destination,
        path,
        network,
        currency,
        config,
      });
    }

    let payload;
    try {
      payload = verifyPaymentToken(config, paymentToken);
    } catch (err) {
      if (err instanceof ExpiredTokenError) {
        const gate = limiter.checkIssue(ip);
        if (!gate.ok) return rateLimited(c, gate.retryAfterMs);
        return issue402(c, {
          amount: price,
          destination: config.destination,
          path,
          network,
          currency,
          config,
          reason: "expired",
        });
      }
      if (err instanceof InvalidTokenError) {
        return c.json({ error: "invalid_token" }, 401);
      }
      throw err;
    }

    if (payload.paymentId !== paymentId) {
      return c.json({ error: "payment_id_mismatch" }, 401);
    }
    if (payload.path !== path) {
      return c.json({ error: "path_mismatch" }, 401);
    }
    if (payload.amount !== price) {
      return c.json({ error: "amount_changed" }, 401);
    }
    if (payload.destination !== config.destination) {
      return c.json({ error: "destination_mismatch" }, 401);
    }

    const gate = limiter.checkVerify(payload.paymentId);
    if (!gate.ok) return rateLimited(c, gate.retryAfterMs);

    const outcome = verifyPayment(config.subscriber, payload);

    switch (outcome.status) {
      case "verified":
        c.header("X-Payment-Signature", outcome.signature);
        config.onVerified?.({
          payload,
          signature: outcome.signature,
          amount: outcome.amount,
          path,
          ip,
        });
        return next();

      case "pending":
        return c.json({ error: "payment_pending" }, 402);

      case "amount_mismatch":
        return c.json(
          {
            error: "amount_mismatch",
            expected: outcome.expected,
            actual: outcome.actual,
          },
          402,
        );

      case "replay":
        return c.json({ error: "replay" }, 409);

      case "rpc_error":
        return c.json({ error: "rpc_error", detail: outcome.error }, 503);

      default: {
        const _exhaustive: never = outcome;
        void _exhaustive;
        return c.json({ error: "unknown" }, 500);
      }
    }
  };
}

interface Issue402Input {
  amount: string;
  destination: string;
  path: string;
  network: string;
  currency: string;
  config: Px402HonoConfig;
  reason?: string;
}

function issue402(c: import("hono").Context, input: Issue402Input) {
  const { paymentId, token, expiry } = createPaymentToken(input.config, {
    path: input.path,
    destination: input.destination,
    amount: input.amount,
  });

  c.header(headerCase(HEADER_AMOUNT), input.amount);
  c.header(headerCase(HEADER_CURRENCY), input.currency);
  c.header(headerCase(HEADER_NETWORK), input.network);
  c.header(headerCase(HEADER_ADDRESS), input.destination);
  c.header(headerCase(HEADER_PAYMENT_ID), paymentId);
  c.header(headerCase(HEADER_PAYMENT_TOKEN), token);

  return c.json(
    {
      error: "payment_required",
      reason: input.reason ?? "initial",
      amount: input.amount,
      currency: input.currency,
      network: input.network,
      destination: input.destination,
      paymentId,
      expiry,
    },
    402,
  );
}

function rateLimited(c: import("hono").Context, retryAfterMs: number) {
  c.header("Retry-After", Math.ceil(retryAfterMs / 1000).toString());
  return c.json({ error: "rate_limited" }, 429);
}

function clientIp(c: import("hono").Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    c.env?.ip ||
    "unknown"
  );
}

function normalizePath(p: string): string {
  const trimmed = p.split("?")[0] ?? p;
  if (trimmed.length > 1 && trimmed.endsWith("/")) return trimmed.slice(0, -1);
  return trimmed;
}

function headerCase(lower: string): string {
  return lower
    .split("-")
    .map((s) => (s ? s[0]!.toUpperCase() + s.slice(1) : s))
    .join("-");
}
