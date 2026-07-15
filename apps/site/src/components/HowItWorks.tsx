import Image from "next/image";
import { ArrowDownRight } from "lucide-react";

const FLOW = [
  ["01", "Request", "Agent asks the protected API for data.", "GET /data"],
  ["02", "Challenge", "Server returns price, destination token, and expiry.", "402"],
  ["03", "Settle", "Client signs a USDC transfer through MagicBlock.", "private rail"],
  ["04", "Redact", "The TEE resolves the recipient away from public view.", "TEE"],
  ["05", "Verify", "Subscriber matches the settlement by clientRefId.", "base chain"],
  ["06", "Respond", "The same request retries and receives the paid result.", "200 OK"],
] as const;

export function HowItWorks() {
  return (
    <section id="how" className="border-b border-line bg-paper-bright">
      <div className="page-shell py-20 sm:py-28">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
          <SectionHead label="protocol trace" title="One request. Six verifiable steps." />
          <p className="max-w-[58ch] text-[18px] leading-[1.6] text-quiet lg:justify-self-end">
            px402 keeps the familiar HTTP payment loop. The private rail changes what settlement
            exposes, not how the client handles a 402.
          </p>
        </div>

        <ol className="mt-12 border-t border-ink">
          {FLOW.map(([number, title, body, signal]) => (
            <li
              key={number}
              className="grid gap-3 border-b border-line py-5 sm:grid-cols-[54px_150px_1fr_120px] sm:items-center sm:gap-6"
            >
              <span className="font-mono text-[11px] text-private">{number}</span>
              <h3 className="text-[20px] font-semibold text-ink">{title}</h3>
              <p className="max-w-[56ch] text-[16px] leading-6 text-quiet">{body}</p>
              <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink sm:text-right">
                {signal}
              </span>
            </li>
          ))}
        </ol>

        <details className="group mt-8 border border-line bg-paper">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 font-mono text-[11px] uppercase tracking-[0.06em] text-ink marker:content-none">
            Open the full protocol sequence
            <ArrowDownRight className="transition-transform group-open:rotate-90" size={16} />
          </summary>
          <div className="border-t border-line bg-paper-bright p-3 sm:p-6">
            <Image
              src="/diagrams/px402-static.png"
              alt="Detailed px402 protocol sequence from request through private settlement and response"
              width={1920}
              height={1080}
              className="h-auto w-full"
            />
          </div>
        </details>
      </div>
    </section>
  );
}

export function SectionHead({ label, title }: { label: string; title: string }) {
  return (
    <div>
      <div className="rule-label text-private">{label}</div>
      <h2 className="mt-5 max-w-[14ch] font-display text-[44px] leading-[0.98] tracking-[-0.035em] text-ink sm:text-[60px]">
        {title}
      </h2>
    </div>
  );
}
