"use client";

import { motion, useReducedMotion } from "motion/react";
import { Check, Eye, EyeOff } from "lucide-react";
import { SectionHead } from "./HowItWorks";

const PUBLIC_ROWS = [
  "Sender wallet",
  "Mint (USDC)",
  "Amount (micro-USDC)",
];

const HIDDEN_ROWS = [
  "Recipient wallet",
  "Which API was paid",
  "Server's revenue mapping",
];

const EASE = [0.16, 1, 0.3, 1] as const;

export function PrivacyProof() {
  const reduce = useReducedMotion();

  const itemInitial = reduce ? false : { opacity: 0, y: 8 };
  const itemAnimate = { opacity: 1, y: 0 };
  const transition = (i: number) => ({
    duration: 0.4,
    delay: i * 0.08,
    ease: EASE,
  });

  return (
    <section id="privacy" className="relative border-t border-border/60">
      <div className="mx-auto max-w-[1100px] px-6 py-24 sm:py-32">
        <SectionHead label="privacy" title="What an explorer sees." />

        <p className="mt-6 max-w-[60ch] text-[17px] leading-[1.65] text-muted-strong">
          The transfer is real and on-chain. Three fields are public. Three are
          hidden inside the TEE.
        </p>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {/* Public column */}
          <motion.div
            initial={reduce ? false : { opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, amount: 0.3 }}
            className="rounded-md border border-border bg-surface/40 p-6 sm:p-7"
          >
            <div className="flex items-center gap-2 text-muted font-mono text-[12px] uppercase tracking-[0.04em] mb-5">
              <Eye size={14} strokeWidth={1.75} />
              public on solana
            </div>
            <ul className="space-y-3">
              {PUBLIC_ROWS.map((row, i) => (
                <motion.li
                  key={row}
                  initial={itemInitial}
                  whileInView={itemAnimate}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={transition(i)}
                  className="flex items-center gap-3 font-mono text-[14px] text-muted-strong"
                >
                  <Check
                    size={14}
                    strokeWidth={2}
                    className="text-muted shrink-0"
                  />
                  <span>{row}</span>
                </motion.li>
              ))}
            </ul>
          </motion.div>

          {/* Hidden column */}
          <motion.div
            initial={reduce ? false : { opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, amount: 0.3 }}
            className="rounded-md border border-accent/20 bg-accent/5 p-6 sm:p-7"
          >
            <div className="flex items-center gap-2 text-accent font-mono text-[12px] uppercase tracking-[0.04em] mb-5">
              <EyeOff size={14} strokeWidth={1.75} />
              hidden inside the tee
            </div>
            <ul className="space-y-3">
              {HIDDEN_ROWS.map((row, i) => (
                <motion.li
                  key={row}
                  initial={itemInitial}
                  whileInView={itemAnimate}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={transition(i + 3)}
                  className="flex items-center gap-3 font-mono text-[14px] text-fg"
                >
                  <Check
                    size={14}
                    strokeWidth={2.25}
                    className="text-accent shrink-0"
                  />
                  <span>{row}</span>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        </div>

        <p className="mt-10 max-w-[64ch] text-[17px] leading-[1.65] text-muted-strong">
          An outside observer cannot tell which API a paying agent consumed.
        </p>
      </div>
    </section>
  );
}
