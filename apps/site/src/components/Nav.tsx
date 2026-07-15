import Link from "next/link";
import { ArrowUpRight, Github } from "lucide-react";
import { Wordmark } from "./Wordmark";
import { SITE } from "@/lib/site";

const NAV_ITEMS = [
  { href: "#privacy", label: "Privacy" },
  { href: "#how", label: "Flow" },
  { href: "#quickstart", label: "Quickstart" },
  { href: "#limits", label: "Limits" },
] as const;

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/92 backdrop-blur-xl">
      <div className="page-shell flex h-16 items-center justify-between gap-4">
        <Link
          href="/"
          aria-label="px402 home"
          className="flex min-h-11 items-center gap-3 transition-opacity hover:opacity-70"
        >
          <Wordmark size="base" accentDigits />
          <span className="hidden border-l border-line pl-3 font-mono text-[10px] uppercase tracking-[0.08em] text-quiet md:inline">
            confidential payment rail
          </span>
        </Link>

        <nav className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.06em]">
          <div className="hidden items-center lg:flex">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex min-h-11 items-center px-3 text-quiet transition-colors hover:text-private"
              >
                {item.label}
              </Link>
            ))}
          </div>
          <Link
            href={SITE.githubUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repository"
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 border-l border-line px-3 text-ink transition-colors hover:text-private sm:min-w-0"
          >
            <Github size={16} strokeWidth={1.6} />
            <span className="hidden sm:inline">Source</span>
          </Link>
          <Link
            href="#quickstart"
            className="inline-flex min-h-11 items-center gap-2 bg-ink px-4 text-paper-bright transition-colors hover:bg-private"
          >
            Start
            <ArrowUpRight size={14} strokeWidth={1.8} />
          </Link>
        </nav>
      </div>
    </header>
  );
}
