import { CodeBlock } from "./CodeBlock";
import { ServerSnippet } from "./ServerSnippet";
import { SectionHead } from "./HowItWorks";
import { SITE } from "@/lib/site";

const CLIENT_CODE = `import { Px402Client } from "@px402/client";

const client = new Px402Client({ wallet, mint });
const res = await client.fetch("${SITE.demoApiBase}/api/sentiment?token=SOL");
const data = await res.json();`;

const MCP_COMMAND = "npx @px402/mcp";

export function Integration() {
  return (
    <section id="quickstart" className="border-b border-line">
      <div className="page-shell py-20 sm:py-28">
        <SectionHead label="quickstart" title="Choose a side. Add one package." />

        <p className="mt-7 max-w-[58ch] text-[18px] leading-[1.6] text-quiet">
          API providers add a framework adapter. Agents replace fetch. MCP users run the server
          directly. Production configuration stays explicit and out of the landing-page happy path.
        </p>

        <div className="mt-12 grid min-w-0 gap-6 lg:grid-cols-2">
          <div className="min-w-0">
            <div className="mb-3 flex min-h-11 items-center justify-between border-b border-ink font-mono text-[10px] uppercase tracking-[0.07em] text-quiet">
              <span>01 / API provider</span>
              <span className="text-private">server</span>
            </div>
            <ServerSnippet />
          </div>
          <div className="min-w-0">
            <div className="mb-3 flex min-h-11 items-center justify-between border-b border-ink font-mono text-[10px] uppercase tracking-[0.07em] text-quiet">
              <span>02 / Agent builder</span>
              <span className="text-private">client</span>
            </div>
            <CodeBlock filename="agent.ts" code={CLIENT_CODE} />
          </div>
        </div>

        <div className="mt-6 grid gap-5 border border-ink bg-paper-bright p-5 sm:grid-cols-[180px_1fr_auto] sm:items-center sm:p-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.07em] text-quiet">
            03 / MCP user
          </div>
          <code className="min-w-0 overflow-x-auto font-mono text-[13px] text-ink">
            $ {MCP_COMMAND}
          </code>
          <a
            href={`${SITE.githubUrl}/tree/main/packages/mcp`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center font-mono text-[11px] uppercase tracking-[0.06em] text-private hover:text-ink"
          >
            MCP reference
          </a>
        </div>
      </div>
    </section>
  );
}
