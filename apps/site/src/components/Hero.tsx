import Link from "next/link";
import { ArrowDownRight, Github, PackageCheck } from "lucide-react";
import { CopyButton } from "./CopyButton";
import { ConfidentialRail } from "./ConfidentialRail";
import { SITE } from "@/lib/site";

const INSTALL_COMMAND = "pnpm add @px402/client";

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-line">
      <div className="page-shell relative grid min-h-[calc(100svh-64px)] items-center gap-14 py-16 lg:grid-cols-[1.02fr_0.98fr] lg:gap-16 lg:py-24">
        <div className="max-w-[680px]">
          <div className="rule-label text-risk">public devnet / v{SITE.latestVersion}</div>

          <h1 className="mt-7 font-display text-[52px] leading-[0.94] tracking-[-0.045em] text-ink sm:text-[72px] lg:text-[82px]">
            Payment happened.
            <br /> Intent stayed
            <span className="text-private"> private.</span>
          </h1>

          <p className="mt-7 max-w-[56ch] text-[18px] leading-[1.55] text-quiet sm:text-[20px]">
            px402 is an HTTP payment layer for AI agents. It settles USDC through MagicBlock&rsquo;s
            private rail so the public chain records payment without revealing which API received
            it.
          </p>

          <div className="mt-9 flex max-w-[560px] min-w-0 items-stretch border border-ink bg-paper-bright">
            <div className="min-w-0 flex-1 overflow-x-auto px-4 py-3 font-mono text-[12px] leading-6 text-ink sm:text-[13px]">
              <span className="text-private">$</span> {INSTALL_COMMAND}
            </div>
            <CopyButton
              text={INSTALL_COMMAND}
              label="install command"
              className="shrink-0 border-l border-ink px-4"
            />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link
              href="#quickstart"
              className="inline-flex min-h-11 items-center gap-2 bg-private px-5 font-mono text-[11px] uppercase tracking-[0.06em] text-paper-bright transition-colors hover:bg-ink"
            >
              <PackageCheck size={15} />
              Quickstart
              <ArrowDownRight size={14} />
            </Link>
            <Link
              href={SITE.githubUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-2 px-1 font-mono text-[11px] uppercase tracking-[0.06em] text-ink transition-colors hover:text-private"
            >
              <Github size={15} />
              Read the source
            </Link>
          </div>
        </div>
        <div className="min-w-0 lg:-mr-3">
          <ConfidentialRail />
        </div>
      </div>
    </section>
  );
}
