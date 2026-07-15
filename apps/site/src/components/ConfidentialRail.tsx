"use client";

import { motion, useReducedMotion } from "motion/react";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";

const TRACE_STEPS = ["GET", "402", "TEE", "200"] as const;

export function ConfidentialRail() {
  const reduce = useReducedMotion();

  return (
    <div className="relative min-w-0 border border-ink bg-paper-bright shadow-[10px_10px_0_0_#111514] sm:shadow-[14px_14px_0_0_#111514]">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-ink px-4 font-mono text-[10px] uppercase tracking-[0.08em] sm:px-5">
        <span>trace / px-000402</span>
        <span className="inline-flex items-center gap-2 text-private">
          <span className="h-2 w-2 bg-private" />
          settlement verified
        </span>
      </div>

      <div className="p-4 sm:p-6">
        <div className="relative grid grid-cols-4 gap-2 pt-2">
          <div className="absolute left-[9%] right-[9%] top-[18px] h-px bg-line-strong" />
          {!reduce ? (
            <motion.div
              aria-hidden="true"
              className="absolute top-[13px] z-10 h-[11px] w-[11px] bg-private"
              initial={{ left: "8%" }}
              animate={{ left: ["8%", "35%", "61%", "88%"] }}
              transition={{
                duration: 3.6,
                times: [0, 0.28, 0.68, 1],
                ease: [0.16, 1, 0.3, 1],
                repeat: Infinity,
                repeatDelay: 1.4,
              }}
            />
          ) : null}
          {TRACE_STEPS.map((step, index) => (
            <div key={step} className="relative z-20 text-center">
              <div
                className={`mx-auto h-9 w-9 border border-ink bg-paper-bright font-mono text-[10px] leading-[34px] ${
                  step === "TEE" ? "bg-private text-paper-bright" : ""
                }`}
              >
                {step}
              </div>
              <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.05em] text-quiet">
                {index === 0
                  ? "request"
                  : index === 1
                    ? "challenge"
                    : index === 2
                      ? "redact"
                      : "response"}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <TraceCard
            icon={<Eye size={14} />}
            label="public ledger"
            rows={[
              ["sender", "3wBh...AiA"],
              ["mint", "USDC"],
              ["amount", "0.01"],
            ]}
          />
          <TraceCard
            icon={<EyeOff size={14} />}
            label="observer cannot resolve"
            privateCard
            rows={[
              ["recipient", "[ REDACTED ]"],
              ["api route", "[ REDACTED ]"],
              ["revenue map", "[ REDACTED ]"],
            ]}
          />
        </div>

        <div className="mt-5 flex items-start gap-3 border-t border-line pt-4">
          <LockKeyhole className="mt-0.5 shrink-0 text-private" size={17} />
          <p className="text-[13px] leading-5 text-quiet">
            Settlement remains real. The link between payer intent and API recipient does not reach
            the public chain.
          </p>
        </div>
      </div>
    </div>
  );
}

function TraceCard({
  icon,
  label,
  rows,
  privateCard = false,
}: {
  icon: React.ReactNode;
  label: string;
  rows: ReadonlyArray<readonly [string, string]>;
  privateCard?: boolean;
}) {
  return (
    <div
      className={`min-w-0 border p-4 ${
        privateCard ? "border-private bg-private-soft/70" : "border-line bg-paper"
      }`}
    >
      <div
        className={`mb-3 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.07em] ${
          privateCard ? "text-private" : "text-quiet"
        }`}
      >
        {icon}
        {label}
      </div>
      <dl className="space-y-2 font-mono text-[10px] sm:text-[11px]">
        {rows.map(([key, value]) => (
          <div key={key} className="grid min-w-0 grid-cols-[82px_1fr] gap-2">
            <dt className="text-quiet">{key}</dt>
            <dd
              className={`min-w-0 break-words text-right ${
                privateCard ? "text-private" : "text-ink"
              }`}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
