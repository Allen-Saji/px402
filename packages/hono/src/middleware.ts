import { createHandler, normalizePath } from "@px402/core";
import type { MiddlewareHandler } from "hono";
import type { Px402HonoConfig } from "./types.js";

export function px402(config: Px402HonoConfig): MiddlewareHandler {
  const handler = createHandler(config);

  return async (c, next) => {
    const paymentId = c.req.header("x-payment-id");
    const paymentToken = c.req.header("x-payment-token");
    const decision = handler.decide({
      path: normalizePath(c.req.path),
      ip: clientIp(c),
      ...(paymentId ? { paymentId } : {}),
      ...(paymentToken ? { paymentToken } : {}),
    });

    if (decision.kind === "next") {
      if (decision.signature) c.header("X-Payment-Signature", decision.signature);
      return next();
    }

    for (const [name, value] of Object.entries(decision.headers)) c.header(name, value);
    return c.json(decision.body as Record<string, unknown>, decision.status as 400);
  };
}

function clientIp(c: import("hono").Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    c.env?.ip ||
    "unknown"
  );
}
