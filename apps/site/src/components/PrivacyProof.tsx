import { Eye, EyeOff, ShieldCheck } from "lucide-react";

const PUBLIC_ROWS = ["Sender wallet", "Mint (USDC)", "Amount (micro-USDC)"];

const HIDDEN_ROWS = ["Recipient wallet", "Which API was paid", "Server's revenue mapping"];

export function PrivacyProof() {
  return (
    <section id="privacy" className="ink-grid bg-ink text-paper-bright">
      <div className="page-shell grid gap-12 py-20 sm:py-28 lg:grid-cols-[0.78fr_1.22fr] lg:gap-20">
        <div>
          <div className="rule-label text-private-bright">privacy proof</div>
          <h2 className="mt-7 max-w-[10ch] font-display text-[48px] leading-[0.98] tracking-[-0.035em] sm:text-[68px]">
            The chain sees settlement. Not intent.
          </h2>
          <p className="mt-7 max-w-[45ch] text-[18px] leading-[1.6] text-paper-deep">
            An outside observer can prove USDC moved. They cannot connect that payment to the API,
            recipient wallet, or server revenue map.
          </p>
          <div className="mt-9 flex items-start gap-3 border-t border-paper-bright/20 pt-5 text-[14px] leading-6 text-paper-deep">
            <ShieldCheck className="mt-1 shrink-0 text-private-bright" size={18} />
            The privacy claim is specific: px402 breaks the public link between payment and API
            consumption.
          </div>
        </div>

        <div className="min-w-0 border border-paper-bright/40 bg-ink">
          <div className="grid border-b border-paper-bright/30 sm:grid-cols-2">
            <ProofColumn icon={<Eye size={15} />} label="public on solana" rows={PUBLIC_ROWS} />
            <ProofColumn
              icon={<EyeOff size={15} />}
              label="hidden inside the tee"
              rows={HIDDEN_ROWS}
              hidden
            />
          </div>
          <div className="grid gap-4 px-5 py-5 font-mono text-[10px] uppercase tracking-[0.07em] text-paper-deep sm:grid-cols-[1fr_auto] sm:items-center sm:px-7">
            <span>observer result / settlement confirmed</span>
            <span className="text-private-bright">recipient unresolved</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProofColumn({
  icon,
  label,
  rows,
  hidden = false,
}: {
  icon: React.ReactNode;
  label: string;
  rows: readonly string[];
  hidden?: boolean;
}) {
  return (
    <div
      className={`min-w-0 p-5 sm:p-7 ${
        hidden ? "border-t border-paper-bright/30 bg-private/15 sm:border-l sm:border-t-0" : ""
      }`}
    >
      <div
        className={`flex min-h-11 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] ${
          hidden ? "text-private-bright" : "text-paper-deep"
        }`}
      >
        {icon}
        {label}
      </div>
      <ul className="mt-5 space-y-3">
        {rows.map((row, index) => (
          <li
            key={row}
            className="grid grid-cols-[24px_1fr] gap-3 border-t border-paper-bright/15 pt-3 font-mono text-[12px] sm:text-[13px]"
          >
            <span className={hidden ? "text-private-bright" : "text-paper-deep"}>0{index + 1}</span>
            <span className={hidden ? "text-paper-bright" : "text-paper-deep"}>
              {hidden ? `[ ${row.toUpperCase()} REDACTED ]` : row}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
