import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { SectionHead } from "./HowItWorks";
import { PACKAGES, SITE } from "@/lib/site";

const ROLE_BY_PACKAGE: Record<string, string> = {
  "@px402/core": "protocol",
  "@px402/hono": "provider",
  "@px402/express": "provider",
  "@px402/next": "provider",
  "@px402/client": "agent",
  "@px402/mcp": "agent tool",
};

export function Packages() {
  return (
    <section id="packages" className="border-b border-line bg-paper-bright">
      <div className="page-shell py-20 sm:py-28">
        <SectionHead label="package index" title="Install only what your role needs." />

        <p className="mt-7 max-w-[58ch] text-[18px] leading-[1.6] text-quiet">
          The protocol stays modular. Providers choose one framework adapter. Agent builders use the
          client or MCP server. Core carries the shared verification machinery.
        </p>

        <div className="mt-12 border-t border-ink">
          {PACKAGES.map((pkg, index) => (
            <div
              key={pkg.name}
              className="grid gap-3 border-b border-line py-5 transition-colors hover:bg-private-soft/55 sm:grid-cols-[54px_200px_120px_1fr] sm:items-center sm:gap-6 sm:px-3"
            >
              <div className="font-mono text-[10px] text-quiet">0{index + 1}</div>
              <div className="font-mono text-[13px] text-private">{pkg.name}</div>
              <div className="font-mono text-[9px] uppercase tracking-[0.07em] text-risk">
                {ROLE_BY_PACKAGE[pkg.name]}
              </div>
              <div className="text-[15px] leading-[1.6] text-quiet">{pkg.purpose}</div>
            </div>
          ))}
        </div>

        <p className="mt-7 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-[0.05em] text-quiet">
          <Link
            href={SITE.npmOrgUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 text-link text-ink transition-colors hover:text-private"
          >
            npm package index
            <ExternalLink size={12} strokeWidth={1.75} />
          </Link>
          <Link
            href={SITE.githubUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 text-link text-ink transition-colors hover:text-private"
          >
            source repository
            <ExternalLink size={12} strokeWidth={1.75} />
          </Link>
        </p>
      </div>
    </section>
  );
}
