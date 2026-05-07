import Link from "next/link";
import { Github, BookOpen, Star } from "lucide-react";
import { Wordmark } from "./Wordmark";
import { SITE } from "@/lib/site";
import { formatStars } from "@/lib/github";

export function Nav({ stars }: { stars: number | null }) {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-bg/70 border-b border-border">
      <div className="mx-auto max-w-[1100px] px-6 h-14 flex items-center justify-between">
        <Link
          href="/"
          aria-label="px402 home"
          className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
        >
          <Wordmark size="base" />
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2 text-[13px] font-mono">
          <Link
            href={`${SITE.githubUrl}#readme`}
            target="_blank"
            rel="noreferrer"
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-muted hover:text-fg hover:bg-surface transition-colors cursor-pointer"
          >
            <BookOpen size={14} strokeWidth={1.75} />
            <span>docs</span>
          </Link>

          <Link
            href={SITE.githubUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repository"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-muted hover:text-fg hover:bg-surface transition-colors cursor-pointer"
          >
            <Github size={14} strokeWidth={1.75} />
            <span className="hidden sm:inline">github</span>
            {stars !== null ? (
              <span className="inline-flex items-center gap-0.5 text-fg">
                <Star size={11} className="text-accent fill-accent" />
                {formatStars(stars)}
              </span>
            ) : null}
          </Link>
        </nav>
      </div>
    </header>
  );
}
