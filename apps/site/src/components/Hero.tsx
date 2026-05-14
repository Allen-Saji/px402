"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { Github, Star, Terminal } from "lucide-react";
import { CopyButton } from "./CopyButton";
import { SITE, PRIMARY_CURL } from "@/lib/site";
import { formatStars } from "@/lib/github";

const EASE = [0.16, 1, 0.3, 1] as const;

// Tokenized curl line for chunked typewriter reveal.
// Order matters; chunks reveal sequentially.
const DEMO_HOST = (() => {
  try {
    return new URL(SITE.demoApiBase).host;
  } catch {
    return "api.px402.example";
  }
})();
const CURL_CHUNKS = ["$ ", "curl ", "https://", DEMO_HOST, "/api/sentiment", "?token=SOL"];

export function Hero({ stars }: { stars: number | null }) {
  const reduce = useReducedMotion();

  return (
    <section className="relative overflow-hidden">
      {/* Faint grid backdrop */}
      <div
        aria-hidden="true"
        className="grid-backdrop absolute inset-0 pointer-events-none"
      />

      <div className="relative mx-auto max-w-[1100px] px-6 pt-20 pb-24 sm:pt-28 sm:pb-32">
        <div className="max-w-[720px]">
          {/* Eyebrow */}
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="font-mono text-[12px] tracking-[0.04em] text-warn mb-6 inline-flex items-center gap-2"
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-warn" />
            pre-alpha · devnet
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE, delay: 0.05 }}
            className="font-sans font-semibold text-fg text-[40px] sm:text-[56px] lg:text-[64px] leading-[1.05] tracking-[-0.025em]"
          >
            Private agentic payments.
            <br />
            <span className="text-muted-strong">x402-shaped.</span>
          </motion.h1>

          {/* Sub */}
          <motion.p
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE, delay: 0.12 }}
            className="mt-6 max-w-[58ch] text-[17px] sm:text-[18px] leading-[1.6] text-muted-strong"
          >
            An HTTP layer over MagicBlock&rsquo;s Private Ephemeral Rollups.
            Agents pay USDC for APIs. The recipient stays hidden.
          </motion.p>

          {/* Curl block */}
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE, delay: 0.2 }}
            className="mt-10 group relative"
          >
            <div className="absolute inset-y-0 left-0 w-[2px] bg-accent rounded-full" />
            <div className="border border-border bg-surface rounded-md overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface-2/40">
                <div className="flex items-center gap-2 text-muted">
                  <Terminal size={13} strokeWidth={1.75} />
                  <span className="font-mono text-[12px]">terminal</span>
                </div>
                <CopyButton text={PRIMARY_CURL} label="copy" />
              </div>
              <div className="px-4 py-4 font-mono text-[14px] sm:text-[15px] leading-[1.55] overflow-x-auto">
                <CurlReveal />
              </div>
            </div>
          </motion.div>

          {/* CTAs */}
          <motion.div
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.7 }}
            className="mt-6 flex flex-wrap items-center gap-3"
          >
            <Link
              href={SITE.githubUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-border bg-surface hover:bg-surface-2 hover:border-border-strong text-fg transition-colors cursor-pointer font-mono text-[13px]"
            >
              <Github size={15} strokeWidth={1.75} />
              <span>Star on GitHub</span>
              {stars !== null ? (
                <span className="inline-flex items-center gap-1 pl-2 ml-1 border-l border-border text-muted">
                  <Star size={11} className="text-accent fill-accent" />
                  <span className="text-fg">{formatStars(stars)}</span>
                </span>
              ) : null}
            </Link>

            <Link
              href={`${SITE.githubUrl}#readme`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-muted hover:text-fg transition-colors cursor-pointer font-mono text-[13px]"
            >
              read the protocol →
            </Link>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function CurlReveal() {
  const reduce = useReducedMotion();

  if (reduce) {
    return (
      <pre className="m-0 whitespace-pre-wrap break-all text-fg">
        <span className="text-muted">$ </span>
        <span className="text-accent">curl</span>
        <span className="text-fg"> https://</span>
        <span className="text-fg">{DEMO_HOST}</span>
        <span className="text-fg">/api/sentiment</span>
        <span className="text-muted">?token=SOL</span>
      </pre>
    );
  }

  return (
    <pre className="m-0 whitespace-pre-wrap break-all text-fg">
      {CURL_CHUNKS.map((chunk, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            duration: 0.18,
            delay: 0.35 + i * 0.07,
            ease: "linear",
          }}
          className={
            i === 0
              ? "text-muted"
              : i === 1
                ? "text-accent"
                : i === 5
                  ? "text-muted"
                  : "text-fg"
          }
        >
          {chunk}
        </motion.span>
      ))}
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35 + CURL_CHUNKS.length * 0.07 }}
        className="caret-blink"
        aria-hidden="true"
      />
    </pre>
  );
}
