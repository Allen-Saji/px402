"use client";

import { useEffect, useRef } from "react";
import { useInView, useReducedMotion } from "motion/react";

export function HowItWorks() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const reduce = useReducedMotion();
  const inView = useInView(videoRef, { amount: 0.5, once: true });

  useEffect(() => {
    if (reduce) return;
    if (inView && videoRef.current) {
      videoRef.current.play().catch(() => {
        // autoplay blocked; user will see the poster, that's fine
      });
    }
  }, [inView, reduce]);

  return (
    <section id="how" className="relative">
      <div className="mx-auto max-w-[1100px] px-6 py-24 sm:py-32">
        <SectionHead label="protocol" title="How it works" />

        <p className="mt-6 max-w-[68ch] text-[17px] leading-[1.65] text-muted-strong">
          The server returns 402 with an HMAC-signed token. The client pays USDC
          through MagicBlock&rsquo;s private rail, encrypting the recipient into
          a TEE box. The server&rsquo;s subscriber polls the queue PDA, matches
          the payment by{" "}
          <code className="font-mono text-[15px] text-fg bg-surface px-1.5 py-0.5 rounded">
            clientRefId
          </code>
          , and serves the response on retry. Stateless server, private
          destination, USDC settlement.
        </p>

        <div className="mt-12 rounded-lg border border-border bg-surface overflow-hidden">
          <video
            ref={videoRef}
            poster="/diagrams/px402-static.png"
            preload="metadata"
            muted
            playsInline
            loop
            controls={false}
            className="w-full h-auto block aspect-video object-contain bg-bg"
            aria-label="px402 protocol animated diagram. Agent pays USDC, MagicBlock TEE decrypts and routes, server returns 200 OK."
          >
            <source src="/diagrams/px402-animated.mp4" type="video/mp4" />
            <track kind="descriptions" />
          </video>
        </div>

        <p className="mt-4 text-[13px] text-muted font-mono">
          frame-accurate render. base-chain pay → TEE decrypt → queue crank →
          server retry.
        </p>
      </div>
    </section>
  );
}

export function SectionHead({
  label,
  title,
  warn = false,
}: {
  label: string;
  title: string;
  warn?: boolean;
}) {
  return (
    <div>
      <div
        className={`font-mono text-[12px] tracking-[0.04em] uppercase ${
          warn ? "text-warn" : "text-accent"
        }`}
      >
        {label}
      </div>
      <h2
        className={`mt-3 text-[28px] sm:text-[40px] font-semibold tracking-[-0.02em] leading-[1.15] ${
          warn ? "text-warn" : "text-fg"
        }`}
      >
        {title}
      </h2>
    </div>
  );
}
