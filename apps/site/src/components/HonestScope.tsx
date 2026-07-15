import Link from "next/link";
import { SectionHead } from "./HowItWorks";
import { SITE } from "@/lib/site";

const THREAT_BOUNDARY = [
  {
    label: "Public",
    tone: "text-risk",
    items: ["Sender wallet", "USDC mint", "Per-call amount"],
  },
  {
    label: "Hidden",
    tone: "text-private",
    items: ["Recipient wallet", "API route", "Revenue mapping"],
  },
  {
    label: "Trusted",
    tone: "text-signal",
    items: ["MagicBlock TEE", "Validator execution", "Subscriber configuration"],
  },
] as const;

const LIMITS = [
  {
    head: "Per-call amount is on-chain.",
    body: "If only one server charges 0.073 USDC for one specific endpoint, the amount itself is a fingerprint.",
  },
  {
    head: "Anonymity-set size matters.",
    body: "At launch, you are alone on the validator. Privacy comes online with volume.",
  },
  {
    head: "Not a drop-in x402 facilitator.",
    body: "Migrating from canonical x402-svm is a rewrite, not a config swap.",
  },
  {
    head: "Pre-alpha. Devnet only.",
    body: "~4s single-call latency. 96.7% success at 30 concurrent. Numbers from a clean devnet run.",
  },
  {
    head: "TEE trust assumption.",
    body: "MagicBlock's TEE has the recipient mapping. If the TEE is compromised, unlinkability is revealed retroactively.",
  },
];

export function HonestScope() {
  return (
    <section id="limits" className="border-b border-line bg-risk-soft/45">
      <div className="page-shell py-20 sm:py-28">
        <SectionHead label="threat model" title="Know the boundary before you ship." />

        <p className="mt-7 max-w-[60ch] text-[18px] leading-[1.6] text-quiet">
          px402 narrows what a public observer can link. It does not make the transfer disappear,
          remove the TEE trust assumption, or turn devnet software into production infrastructure.
        </p>

        <div className="mt-12 grid border border-ink bg-paper-bright lg:grid-cols-3">
          {THREAT_BOUNDARY.map((column) => (
            <div
              key={column.label}
              className="border-b border-ink p-6 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0"
            >
              <div className={`font-mono text-[10px] uppercase tracking-[0.08em] ${column.tone}`}>
                {column.label}
              </div>
              <ul className="mt-5 space-y-3">
                {column.items.map((item, index) => (
                  <li
                    key={item}
                    className="grid grid-cols-[26px_1fr] gap-3 border-t border-line pt-3 font-mono text-[12px] text-ink"
                  >
                    <span className="text-quiet">0{index + 1}</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 border-t border-ink">
          {LIMITS.map((item, index) => (
            <div
              key={item.head}
              className="grid gap-2 border-b border-line py-5 sm:grid-cols-[54px_260px_1fr] sm:gap-6"
            >
              <span className="font-mono text-[10px] text-risk">0{index + 1}</span>
              <h3 className="font-mono text-[12px] text-ink">{item.head}</h3>
              <p className="max-w-[62ch] text-[15px] leading-6 text-quiet">{item.body}</p>
            </div>
          ))}
        </div>

        <p className="mt-9 max-w-[64ch] text-[16px] leading-[1.65] text-quiet">
          These are current constraints, not hidden footnotes. Read the{" "}
          <Link
            href={`${SITE.githubUrl}#readme`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center text-link text-ink transition-colors hover:text-private"
          >
            README
          </Link>{" "}
          for the full list.
        </p>
      </div>
    </section>
  );
}
