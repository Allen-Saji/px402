import { Px402Client } from "@px402/client";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Keypair } from "@solana/web3.js";
import { z } from "zod";

export interface Px402McpConfig {
  /** The agent's Solana keypair. Signs base-chain private-transfer txs. */
  wallet: Keypair;
  /** SPL mint accepted for payments. */
  mint: string;
  /** REST base. Default: https://payments.magicblock.app */
  apiUrl?: string;
  /** Base-chain RPC. Default: https://rpc.magicblock.app/devnet */
  baseRpcUrl?: string;
  /** Ephemeral rollup RPC. Default: https://devnet.magicblock.app */
  ephemeralRpcUrl?: string;
  /** Cluster. Default: "devnet" */
  cluster?: string;
}

/**
 * Build an MCP server that exposes two tools:
 *
 *   px402_fetch   — call any HTTP endpoint, pay on 402, return the response
 *   px402_balance — read the agent wallet's base-chain USDC balance
 *
 * Wire it up in a Claude Desktop / Code config by pointing the `command` at
 * `px402-mcp` (the packaged bin) with env vars for the keypair and mint.
 */
export function createPx402McpServer(cfg: Px402McpConfig): McpServer {
  const client = new Px402Client({
    wallet: cfg.wallet,
    mint: cfg.mint,
    ...(cfg.apiUrl ? { apiUrl: cfg.apiUrl } : {}),
    ...(cfg.baseRpcUrl ? { baseRpcUrl: cfg.baseRpcUrl } : {}),
    ...(cfg.ephemeralRpcUrl ? { ephemeralRpcUrl: cfg.ephemeralRpcUrl } : {}),
    ...(cfg.cluster ? { cluster: cfg.cluster } : {}),
  });

  const server = new McpServer({
    name: "px402",
    version: "0.0.1",
  });

  server.tool(
    "px402_fetch",
    "Call a paid API. Automatically pays with USDC on a 402 response and returns the final body.",
    {
      url: z.string().url(),
      method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET"),
      headers: z.record(z.string()).optional(),
      body: z.string().optional(),
    },
    async ({ url, method, headers, body }) => {
      const init: RequestInit = {
        method,
        ...(headers ? { headers } : {}),
        ...(body ? { body } : {}),
      };
      const res = await client.fetch(url, init);
      const text = await res.text();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: res.status,
                signature: res.headers.get("x-payment-signature") ?? null,
                body: tryJson(text),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "px402_balance",
    "Read the agent wallet's base-chain USDC balance.",
    {},
    async () => {
      const balance = await client.balance();
      return {
        content: [{ type: "text", text: JSON.stringify(balance, null, 2) }],
      };
    },
  );

  return server;
}

export async function runStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
