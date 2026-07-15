import { CopyButton } from "./CopyButton";
import { SectionHead } from "./HowItWorks";
import { DEMO_ENDPOINTS, SITE } from "@/lib/site";
import { CheckCircle2, Clock3, ShieldCheck } from "lucide-react";

const DEMO_CURL = `curl -i ${SITE.demoApiBase}/api/sentiment?token=SOL`;

export function DemoCallout() {
  return (
    <section id="demo" className="border-b border-line bg-paper-deep/65">
      <div className="page-shell py-20 sm:py-28">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
          <SectionHead label="verified devnet" title="A 402 you can inspect." />
          <div className="grid grid-cols-2 gap-px border border-ink bg-ink lg:justify-self-end">
            <Metric label="single call" value="~4s" />
            <Metric label="30 concurrent" value="96.7%" />
          </div>
        </div>

        <p className="mt-7 max-w-[58ch] text-[18px] leading-[1.6] text-quiet">
          The API data is illustrative. The payment path is not. Each route returns a real 402,
          settles USDC, and serves data only after the retry.
        </p>

        <div className="mt-10 overflow-hidden border border-ink bg-paper-bright">
          <div className="grid grid-cols-[1fr_auto] gap-x-4 border-b border-ink bg-ink px-4 py-3 font-mono text-[9px] uppercase tracking-[0.07em] text-paper-deep sm:grid-cols-[2fr_auto_3fr] sm:gap-x-6 sm:px-6">
            <div>route</div>
            <div className="text-right">price</div>
            <div className="hidden sm:block">returns</div>
          </div>
          {DEMO_ENDPOINTS.map((ep) => (
            <div
              key={ep.path}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-line px-4 py-4 last:border-b-0 sm:grid-cols-[2fr_auto_3fr] sm:gap-x-6 sm:px-6"
            >
              <div className="min-w-0 break-all font-mono text-[12px] text-ink sm:text-[13px]">
                {ep.path}
              </div>
              <div className="whitespace-nowrap text-right font-mono text-[12px] text-private sm:text-[13px]">
                {ep.price}
              </div>
              <div className="col-span-2 text-[14px] leading-[1.5] text-quiet sm:col-span-1">
                {ep.purpose}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-7 min-w-0 border border-ink bg-ink text-paper-bright">
          <div className="flex min-h-12 items-center justify-between border-b border-paper-bright/20 pl-4 font-mono text-[9px] uppercase tracking-[0.07em] text-paper-deep">
            <span>recorded trace / clean devnet</span>
            <CopyButton
              text={DEMO_CURL}
              label="request command"
              className="border-l border-paper-bright/20 text-paper-deep hover:bg-paper-bright hover:text-ink"
            />
          </div>

          <div className="grid border-b border-paper-bright/20 md:grid-cols-3">
            <TraceStep
              number="01"
              icon={<Clock3 size={16} />}
              title="Request challenged"
              code="HTTP 402"
            />
            <TraceStep
              number="02"
              icon={<ShieldCheck size={16} />}
              title="Private settlement"
              code="USDC / TEE"
            />
            <TraceStep
              number="03"
              icon={<CheckCircle2 size={16} />}
              title="Retry accepted"
              code="HTTP 200"
            />
          </div>

          <div className="min-w-0 p-4 sm:p-6">
            <div className="max-w-full overflow-x-auto overscroll-x-contain">
              <pre className="m-0 w-max min-w-full font-mono text-[11px] leading-6 sm:text-[12px]">
                <span className="text-private-bright">$ curl -i</span>{" "}
                <span>{SITE.demoApiBase}/api/sentiment?token=SOL</span>
                {"\n"}
                <span className="text-signal">HTTP/1.1 402 Payment Required</span>
                {"\n"}
                <span className="text-paper-deep">X-Payment-Amount: 10000</span>
                {"\n"}
                <span className="text-paper-deep">X-Payment-Token: v1.eyJ...</span>
              </pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[130px] bg-paper-bright p-4">
      <div className="font-mono text-[9px] uppercase tracking-[0.07em] text-quiet">{label}</div>
      <div className="mt-1 font-display text-[28px] leading-none text-ink">{value}</div>
    </div>
  );
}

function TraceStep({
  number,
  icon,
  title,
  code,
}: {
  number: string;
  icon: React.ReactNode;
  title: string;
  code: string;
}) {
  return (
    <div className="border-b border-paper-bright/20 p-5 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
      <div className="flex items-center justify-between text-private-bright">
        <span className="font-mono text-[10px]">{number}</span>
        {icon}
      </div>
      <div className="mt-5 text-[16px] font-semibold">{title}</div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.06em] text-paper-deep">
        {code}
      </div>
    </div>
  );
}
