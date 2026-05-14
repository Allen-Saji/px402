import { CodeBlock } from "./CodeBlock";
import { SectionHead } from "./HowItWorks";
import { SITE } from "@/lib/site";

const SERVER_CODE = `import { Hono } from "hono";
import { px402 } from "@px402/hono";
import { PrivateTransferSubscriber } from "@px402/core";

const subscriber = new PrivateTransferSubscriber({
  rpcUrl,        // base RPC
  queuePda,
  mint,
  receiverWallet,
});
await subscriber.start();

const app = new Hono();
app.use(px402({
  serverSecret: process.env.PX402_SECRET!,
  paymentAddress: SERVER_WALLET,
  pricing: { "/api/sentiment": "10000" }, // micro-USDC
  subscriber,
}));

app.get("/api/sentiment", (c) =>
  c.json({ signal: "bullish" }),
);`;

const CLIENT_CODE = `import { Px402Client } from "@px402/client";

const client = new Px402Client({ wallet, mint });
const res = await client.fetch(
  "${SITE.demoApiBase}/api/sentiment?token=SOL",
);
const data = await res.json();`;

export function Integration() {
  return (
    <section id="integration" className="relative border-t border-border/60">
      <div className="mx-auto max-w-[1100px] px-6 py-24 sm:py-32">
        <SectionHead label="integration" title="Two lines, two sides." />

        <p className="mt-6 max-w-[60ch] text-[17px] leading-[1.65] text-muted-strong">
          One middleware on the server. One{" "}
          <code className="font-mono text-[15px] text-fg bg-surface px-1.5 py-0.5 rounded">
            fetch
          </code>{" "}
          wrapper on the client. Everything else is the protocol doing its job.
        </p>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <div>
            <div className="font-mono text-[12px] text-muted mb-3 inline-flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent/70" />
              server
            </div>
            <CodeBlock filename="server.ts" code={SERVER_CODE} />
          </div>
          <div>
            <div className="font-mono text-[12px] text-muted mb-3 inline-flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent/70" />
              client
            </div>
            <CodeBlock filename="agent.ts" code={CLIENT_CODE} />
          </div>
        </div>
      </div>
    </section>
  );
}
