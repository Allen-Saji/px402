import { CopyButton } from "./CopyButton";
import { SectionHead } from "./HowItWorks";
import { DEMO_ENDPOINTS, SITE } from "@/lib/site";

const DEMO_CURL = `# step 1: fetch the route, server returns 402 with payment headers
$ curl -i ${SITE.demoApiBase}/api/sentiment?token=SOL
HTTP/1.1 402 Payment Required
X-Payment-Amount: 10000
X-Payment-Address: 6dRPtBVYi...
X-Payment-Id: 1234567890
X-Payment-Token: v1.eyJ...

# step 2: pay + retry through @px402/client (curl can't sign Solana txs)
$ pnpm tsx examples/agent --route /api/sentiment`;

export function DemoCallout() {
  return (
    <section id="demo" className="relative border-t border-border/60">
      <div className="mx-auto max-w-[1100px] px-6 py-24 sm:py-32">
        <SectionHead label="live demo" title="Run a paid call against devnet." />

        <p className="mt-6 max-w-[60ch] text-[17px] leading-[1.65] text-muted-strong">
          Three priced routes. Mock data, real protocol. Each call settles a
          USDC payment before the response lands.
        </p>

        <div className="mt-10 rounded-md border border-border overflow-hidden">
          <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[2fr_auto_3fr] gap-x-6 px-4 sm:px-6 py-3 border-b border-border bg-surface-2/30 font-mono text-[11px] uppercase tracking-[0.04em] text-muted">
            <div>route</div>
            <div className="text-right">price</div>
            <div className="hidden sm:block">returns</div>
          </div>
          {DEMO_ENDPOINTS.map((ep) => (
            <div
              key={ep.path}
              className="grid grid-cols-[1fr_auto] sm:grid-cols-[2fr_auto_3fr] gap-x-6 gap-y-1 px-4 sm:px-6 py-4 border-b border-border last:border-b-0 items-center"
            >
              <div className="font-mono text-[14px] text-fg break-all">
                {ep.path}
              </div>
              <div className="font-mono text-[14px] text-accent text-right whitespace-nowrap">
                {ep.price}
              </div>
              <div className="col-span-2 sm:col-span-1 text-[14px] text-muted-strong leading-[1.5]">
                {ep.purpose}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 group relative">
          <div className="absolute inset-y-0 left-0 w-[2px] bg-accent rounded-full" />
          <div className="border border-border bg-surface rounded-md overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface-2/40">
              <div className="font-mono text-[12px] text-muted">
                terminal · devnet
              </div>
              <CopyButton text={DEMO_CURL} label="copy" />
            </div>
            <pre className="m-0 px-4 py-4 font-mono text-[13px] leading-[1.65] text-fg/90 overflow-x-auto">
              <span className="text-muted">
                # step 1: fetch the route, server returns 402 with payment headers
                {"\n"}
              </span>
              <span className="text-accent">$ curl -i</span>{" "}
              <span className="text-fg">
                {SITE.demoApiBase}/api/sentiment?token=SOL
              </span>
              {"\n"}
              <span className="text-emerald-300/90">
                HTTP/1.1 402 Payment Required
              </span>
              {"\n"}
              <span className="text-emerald-300/90">X-Payment-Amount: 10000</span>
              {"\n"}
              <span className="text-emerald-300/90">
                X-Payment-Address: 6dRPtBVYi...
              </span>
              {"\n"}
              <span className="text-emerald-300/90">X-Payment-Id: 1234567890</span>
              {"\n"}
              <span className="text-emerald-300/90">X-Payment-Token: v1.eyJ...</span>
              {"\n\n"}
              <span className="text-muted">
                # step 2: pay + retry through @px402/client (curl can&apos;t sign Solana txs)
                {"\n"}
              </span>
              <span className="text-accent">$ pnpm tsx examples/agent</span>{" "}
              <span className="text-fg">--route /api/sentiment</span>
            </pre>
          </div>
        </div>

        <p className="mt-4 text-[13px] text-muted font-mono">
          ~4s end-to-end. 96.7% success at 30 concurrent.
        </p>
      </div>
    </section>
  );
}
