import Link from "next/link";
import { Github, ExternalLink } from "lucide-react";
import { Wordmark } from "./Wordmark";
import { SITE } from "@/lib/site";

export function Footer() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto max-w-[1100px] px-6 py-12 sm:py-16 grid gap-10 sm:grid-cols-[1fr_auto_auto] items-start">
        <div>
          <Wordmark size="base" />
          <p className="mt-4 text-[13px] text-muted leading-[1.65] max-w-[40ch] font-mono">
            MIT licensed. Built on{" "}
            <Link
              href={SITE.magicblockUrl}
              target="_blank"
              rel="noreferrer"
              className="text-fg hover:text-accent transition-colors cursor-pointer underline-offset-2 hover:underline"
            >
              MagicBlock PER
            </Link>{" "}
            and{" "}
            <Link
              href={SITE.x402Url}
              target="_blank"
              rel="noreferrer"
              className="text-fg hover:text-accent transition-colors cursor-pointer underline-offset-2 hover:underline"
            >
              x402
            </Link>
            .
          </p>
        </div>

        <nav className="flex flex-col gap-2.5 font-mono text-[13px]">
          <Link
            href={`${SITE.githubUrl}#readme`}
            target="_blank"
            rel="noreferrer"
            className="text-muted hover:text-fg transition-colors cursor-pointer inline-flex items-center gap-1.5"
          >
            docs
            <ExternalLink size={11} strokeWidth={1.75} />
          </Link>
          <Link
            href={SITE.githubUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="text-muted hover:text-fg transition-colors cursor-pointer inline-flex items-center gap-1.5"
          >
            <Github size={13} strokeWidth={1.75} />
            github
          </Link>
          <Link
            href={`${SITE.githubUrl}/tree/main/packages/mcp`}
            target="_blank"
            rel="noreferrer"
            className="text-muted hover:text-fg transition-colors cursor-pointer inline-flex items-center gap-1.5"
          >
            mcp
            <ExternalLink size={11} strokeWidth={1.75} />
          </Link>
        </nav>

        <div className="font-mono text-[13px] text-muted leading-[1.7]">
          <div>
            Built by{" "}
            <Link
              href={SITE.authorUrl}
              target="_blank"
              rel="noreferrer"
              className="text-fg hover:text-accent transition-colors cursor-pointer underline-offset-2 hover:underline"
            >
              Allen Saji
            </Link>
          </div>
          <div className="mt-1">
            Powered by{" "}
            <Link
              href={SITE.magicblockUrl}
              target="_blank"
              rel="noreferrer"
              className="text-fg hover:text-accent transition-colors cursor-pointer underline-offset-2 hover:underline"
            >
              MagicBlock
            </Link>
          </div>
          <Link
            href={SITE.twitterUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-muted hover:text-fg transition-colors cursor-pointer"
          >
            @SajiBhai011
          </Link>
        </div>
      </div>
    </footer>
  );
}
