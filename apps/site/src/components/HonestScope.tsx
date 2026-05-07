import Link from "next/link";
import { SectionHead } from "./HowItWorks";
import { SITE } from "@/lib/site";

const LIMITS = [
  {
    head: "Per-call amount is on-chain.",
    body:
      "If only one server charges 0.073 USDC for one specific endpoint, the amount itself is a fingerprint.",
  },
  {
    head: "Anonymity-set size matters.",
    body:
      "At launch, you are alone on the validator. Privacy comes online with volume.",
  },
  {
    head: "Not a drop-in x402 facilitator.",
    body:
      "Migrating from canonical x402-svm is a rewrite, not a config swap.",
  },
  {
    head: "Pre-alpha. Devnet only.",
    body:
      "~4s single-call latency. 96.7% success at 30 concurrent. Numbers from a clean devnet run.",
  },
  {
    head: "TEE trust assumption.",
    body:
      "MagicBlock's TEE has the recipient mapping. If the TEE is compromised, unlinkability is revealed retroactively.",
  },
];

export function HonestScope() {
  return (
    <section id="honest" className="relative border-t border-border/60">
      <div className="mx-auto max-w-[1100px] px-6 py-24 sm:py-32">
        <SectionHead
          label="honest scope"
          title="What is NOT private (and other honest scope)."
          warn
        />

        <ul className="mt-12 space-y-7 max-w-[72ch]">
          {LIMITS.map((item) => (
            <li key={item.head} className="grid grid-cols-[12px_1fr] gap-4">
              <span
                aria-hidden="true"
                className="mt-[10px] block w-2 h-2 rounded-[1px] bg-warn/80"
              />
              <div>
                <div className="font-mono text-[14px] text-warn">
                  {item.head}
                </div>
                <p className="mt-1.5 text-[16px] leading-[1.6] text-muted-strong">
                  {item.body}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-12 max-w-[64ch] text-[16px] leading-[1.65] text-muted-strong">
          These are honest constraints, not roadmap items. Read the{" "}
          <Link
            href={`${SITE.githubUrl}#readme`}
            target="_blank"
            rel="noreferrer"
            className="text-fg hover:text-accent transition-colors cursor-pointer underline-offset-4 underline decoration-border-strong hover:decoration-accent"
          >
            README
          </Link>{" "}
          for the full list.
        </p>
      </div>
    </section>
  );
}
