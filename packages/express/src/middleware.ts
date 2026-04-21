import { createHandler, normalizePath } from "@px402/core";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Px402ExpressConfig } from "./types.js";

export function px402(config: Px402ExpressConfig): RequestHandler {
  const handler = createHandler(config);

  return (req: Request, res: Response, next: NextFunction) => {
    const paymentId = headerValue(req, "x-payment-id");
    const paymentToken = headerValue(req, "x-payment-token");
    const decision = handler.decide({
      path: normalizePath(req.path),
      ip: clientIp(req),
      ...(paymentId ? { paymentId } : {}),
      ...(paymentToken ? { paymentToken } : {}),
    });

    if (decision.kind === "next") {
      if (decision.signature) res.setHeader("X-Payment-Signature", decision.signature);
      return next();
    }

    for (const [name, value] of Object.entries(decision.headers)) res.setHeader(name, value);
    res.status(decision.status).json(decision.body);
  };
}

function clientIp(req: Request): string {
  const fwd = headerValue(req, "x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() ?? "unknown";
  return headerValue(req, "x-real-ip") ?? req.ip ?? "unknown";
}

function headerValue(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0];
  return v;
}
