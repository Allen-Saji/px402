import { createHandler, normalizePath, type HandlerConfig } from "@px402/core";
import { NextResponse, type NextRequest } from "next/server";

export type Px402NextConfig = HandlerConfig;

type NextRouteHandler = (req: NextRequest, ctx?: unknown) => Promise<Response> | Response;

/**
 * Wrap a Next.js App Router route handler with px402 payment enforcement.
 *
 * Usage (app/api/sentiment/route.ts):
 *
 *   export const GET = withPx402(config, async (req) => NextResponse.json({ ... }));
 */
export function withPx402(
  config: Px402NextConfig,
  handler: NextRouteHandler,
): NextRouteHandler {
  const px = createHandler(config);

  return async (req, ctx) => {
    const decision = px.decide({
      path: normalizePath(new URL(req.url).pathname),
      ip: clientIp(req),
      ...(req.headers.get("x-payment-id") ? { paymentId: req.headers.get("x-payment-id")! } : {}),
      ...(req.headers.get("x-payment-token")
        ? { paymentToken: req.headers.get("x-payment-token")! }
        : {}),
    });

    if (decision.kind === "next") {
      const res = await handler(req, ctx);
      if (decision.signature) {
        const clone = new Response(res.body, res);
        clone.headers.set("X-Payment-Signature", decision.signature);
        return clone;
      }
      return res;
    }

    return NextResponse.json(decision.body, {
      status: decision.status,
      headers: decision.headers,
    });
  };
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() ?? "unknown";
  return req.headers.get("x-real-ip") ?? "unknown";
}
