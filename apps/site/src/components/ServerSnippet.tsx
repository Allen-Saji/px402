"use client";

import { useState } from "react";
import { CodeBlock } from "./CodeBlock";

const HONO_CODE = `import { Hono } from "hono";
import { px402 } from "@px402/hono";

const app = new Hono();
app.use(px402(paymentConfig));
app.get("/api/sentiment", handler);`;

const EXPRESS_CODE = `import express from "express";
import { px402 } from "@px402/express";

const app = express();
app.use(px402(paymentConfig));
app.get("/api/sentiment", handler);`;

const NEXT_CODE = `// app/api/sentiment/route.ts
import { NextResponse } from "next/server";
import { withPx402 } from "@px402/next";

export const GET = withPx402(
  paymentConfig,
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
  {
    id: "express",
    label: "Express",
    pkg: "@px402/express",
    filename: "server.ts",
    code: EXPRESS_CODE,
  },
  {
    id: "next",
    label: "Next.js",
    pkg: "@px402/next",
    filename: "app/api/sentiment/route.ts",
    code: NEXT_CODE,
  },
] as const;

export function ServerSnippet() {
  const [active, setActive] = useState<FrameworkId>("hono");

  return (
    <div>
      <div
        role="tablist"
        aria-label="Server framework"
        className="mb-3 flex w-fit max-w-full items-center border border-ink bg-paper-bright p-1"
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
                "min-h-11 px-3 font-mono text-[11px] transition-colors cursor-pointer",
                isActive
                  ? "bg-ink text-paper-bright"
                  : "text-quiet hover:bg-private-soft hover:text-private",
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
          <p className="mt-3 overflow-x-auto font-mono text-[11px] text-quiet">
            <span className="text-private">pnpm add</span> {fw.pkg} @px402/core
          </p>
        </div>
      ))}
    </div>
  );
}
