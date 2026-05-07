import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { SectionHead } from "./HowItWorks";
import { PACKAGES, SITE } from "@/lib/site";

export function Packages() {
  return (
    <section id="packages" className="relative border-t border-border/60">
      <div className="mx-auto max-w-[1100px] px-6 py-24 sm:py-32">
        <SectionHead label="packages" title="Six packages. Pick what you need." />

        <p className="mt-6 max-w-[60ch] text-[17px] leading-[1.65] text-muted-strong">
          Adopters install one adapter for their framework plus the client. The
          surface stays small on purpose.
        </p>

        <div className="mt-10 border-t border-border">
          {PACKAGES.map((pkg) => (
            <div
              key={pkg.name}
              className="grid grid-cols-1 sm:grid-cols-[260px_1fr] gap-2 sm:gap-8 items-start sm:items-center px-2 sm:px-4 py-5 border-b border-border hover:bg-surface/40 transition-colors"
            >
              <div className="font-mono text-[14px] text-accent">
                {pkg.name}
              </div>
              <div className="text-[15px] text-muted-strong leading-[1.6]">
                {pkg.purpose}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-6 text-[14px] text-muted font-mono leading-[1.65]">
          coming to npm soon. for now:{" "}
          <Link
            href={SITE.githubUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-fg hover:text-accent transition-colors cursor-pointer underline-offset-2 hover:underline"
          >
            github.com/{SITE.githubRepo}
            <ExternalLink size={12} strokeWidth={1.75} />
          </Link>
        </p>
      </div>
    </section>
  );
}
