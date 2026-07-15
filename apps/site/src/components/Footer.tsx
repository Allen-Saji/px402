import Link from "next/link";
import { Github, ExternalLink } from "lucide-react";
import { Wordmark } from "./Wordmark";
import { SITE } from "@/lib/site";

export function Footer() {
  return (
    <footer className="bg-ink text-paper-bright">
      <div className="page-shell grid items-start gap-10 py-12 sm:grid-cols-[1fr_auto_auto] sm:py-16">
        <div>
          <Wordmark size="lg" accentDigits className="[&_.text-ink]:text-paper-bright" />
          <p className="mt-4 max-w-[42ch] font-mono text-[11px] leading-5 text-paper-deep">
            Apache-2.0 licensed. Built on{" "}
            <Link
              href={SITE.magicblockUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center text-link text-paper-bright transition-colors hover:text-private-bright"
            >
              MagicBlock PER
            </Link>{" "}
            and{" "}
            <Link
              href={SITE.x402Url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 min-w-11 items-center justify-center text-link text-paper-bright transition-colors hover:text-private-bright"
            >
              x402
            </Link>
            .
          </p>
        </div>

        <nav className="flex flex-col font-mono text-[11px] uppercase tracking-[0.05em]">
          <Link
            href={`${SITE.githubUrl}#readme`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 text-paper-deep transition-colors hover:text-private-bright"
          >
            docs
            <ExternalLink size={11} strokeWidth={1.75} />
          </Link>
          <Link
            href={SITE.githubUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="inline-flex min-h-11 items-center gap-1.5 text-paper-deep transition-colors hover:text-private-bright"
          >
            <Github size={13} strokeWidth={1.75} />
            github
          </Link>
          <Link
            href={`${SITE.githubUrl}/tree/main/packages/mcp`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 text-paper-deep transition-colors hover:text-private-bright"
          >
            mcp
            <ExternalLink size={11} strokeWidth={1.75} />
          </Link>
        </nav>

        <div className="font-mono text-[11px] leading-5 text-paper-deep">
          <div>
            Built by{" "}
            <Link
              href={SITE.authorUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center text-link text-paper-bright transition-colors hover:text-private-bright"
            >
              {SITE.authorName}
            </Link>
          </div>
          <div className="mt-1">
            Powered by{" "}
            <Link
              href={SITE.magicblockUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center text-link text-paper-bright transition-colors hover:text-private-bright"
            >
              MagicBlock
            </Link>
          </div>
          <Link
            href={SITE.twitterUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex min-h-11 items-center text-paper-deep transition-colors hover:text-private-bright"
          >
            {SITE.twitterHandle}
          </Link>
        </div>
      </div>
    </footer>
  );
}
