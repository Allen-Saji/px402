"use client";

import { useState } from "react";
import { CodeBlock } from "./CodeBlock";

const HONO_CODE = `import { Hono } from "hono";
import { px402 } from "@px402/hono";
import { PrivateTransferSubscriber } from "@px402/core";

const subscriber = new PrivateTransferSubscriber({
  rpcUrl,        // base RPC
  queuePda,
  mint,
  receiverWallet,
});
await subscriber.start();

const app = new Hono();
app.use(px402({
  serverSecret: process.env.PX402_SECRET!,
  paymentAddress: SERVER_WALLET,
  pricing: { "/api/sentiment": "10000" }, // micro-USDC
  subscriber,
}));

app.get("/api/sentiment", (c) =>
  c.json({ signal: "bullish" }),
);`;

const EXPRESS_CODE = `import express from "express";
import { px402 } from "@px402/express";
import { PrivateTransferSubscriber } from "@px402/core";

const subscriber = new PrivateTransferSubscriber({
  rpcUrl,        // base RPC
  queuePda,
  mint,
  receiverWallet,
});
await subscriber.start();

const app = express();
app.use(px402({
  serverSecret: process.env.PX402_SECRET!,
  paymentAddress: SERVER_WALLET,
  pricing: { "/api/sentiment": "10000" }, // micro-USDC
  subscriber,
}));

app.get("/api/sentiment", (_req, res) =>
  res.json({ signal: "bullish" }),
);`;

const NEXT_CODE = `// app/api/sentiment/route.ts
import { NextResponse } from "next/server";
import { withPx402 } from "@px402/next";
import { PrivateTransferSubscriber } from "@px402/core";

const subscriber = new PrivateTransferSubscriber({
  rpcUrl,        // base RPC
  queuePda,
  mint,
  receiverWallet,
});
await subscriber.start();

export const GET = withPx402(
  {
    serverSecret: process.env.PX402_SECRET!,
    paymentAddress: SERVER_WALLET,
    pricing: { "/api/sentiment": "10000" }, // micro-USDC
    subscriber,
  },
  () => NextResponse.json({ signal: "bullish" }),
);`;

type FrameworkId = "hono" | "express" | "next";

const FRAMEWORKS: ReadonlyArray<{
  id: FrameworkId;
  label: string;
  pkg: string;
  filename: string;
  code: string;
}> = [
  { id: "hono", label: "Hono", pkg: "@px402/hono", filename: "server.ts", code: HONO_CODE },
  { id: "express", label: "Express", pkg: "@px402/express", filename: "server.ts", code: EXPRESS_CODE },
  { id: "next", label: "Next.js", pkg: "@px402/next", filename: "app/api/sentiment/route.ts", code: NEXT_CODE },
] as const;

export function ServerSnippet() {
  const [active, setActive] = useState<FrameworkId>("hono");

  return (
    <div>
      <div
        role="tablist"
        aria-label="Server framework"
        className="flex items-center gap-1 mb-3 border border-border rounded-md bg-surface/50 p-1 w-fit"
      >
        {FRAMEWORKS.map((fw) => {
          const isActive = active === fw.id;
          return (
            <button
              key={fw.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${fw.id}`}
              id={`tab-${fw.id}`}
              onClick={() => setActive(fw.id)}
              className={[
                "font-mono text-[12px] px-3 py-1.5 rounded transition-colors cursor-pointer",
                isActive
                  ? "bg-surface-2 text-fg"
                  : "text-muted hover:text-fg hover:bg-surface-2/50",
              ].join(" ")}
            >
              {fw.label}
            </button>
          );
        })}
      </div>

      {FRAMEWORKS.map((fw) => (
        <div
          key={fw.id}
          role="tabpanel"
          id={`panel-${fw.id}`}
          aria-labelledby={`tab-${fw.id}`}
          hidden={active !== fw.id}
        >
          <CodeBlock filename={fw.filename} code={fw.code} />
          <p className="mt-2 font-mono text-[11px] text-muted">
            <span className="text-muted-strong">pnpm add</span>{" "}
            {fw.pkg} @px402/core
          </p>
        </div>
      ))}
    </div>
  );
}
