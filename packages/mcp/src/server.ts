import { Px402Client, type BalanceResponse } from "@px402/client";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Keypair } from "@solana/web3.js";
import { z } from "zod";

/**
 * Minimal surface of @px402/client that the MCP tool handlers need. Defined
 * separately so handlers can be unit-tested without standing up a real client.
 */
export interface Px402ClientLike {
  fetch(url: string | URL, init?: RequestInit): Promise<Response>;
  balance(): Promise<BalanceResponse>;
}

export interface FetchToolArgs {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: string;
}

export interface FetchToolResultBody {
  status: number;
  signature: string | null;
  body: unknown;
}

/** Matches the MCP SDK's expected tool-result shape (open record + typed content). */
type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  [key: string]: unknown;
};

export const fetchInputSchema = {
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET"),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
};

/**
 * Run the px402_fetch tool against a client. Exported for testing — the live
 * MCP server registers this via `server.tool()` in `createPx402McpServer`.
 */
export async function handleFetch(
  client: Px402ClientLike,
  args: FetchToolArgs,
): Promise<McpToolResult> {
  const init: RequestInit = {
    method: args.method ?? "GET",
    ...(args.headers ? { headers: args.headers } : {}),
    ...(args.body ? { body: args.body } : {}),
  };
  const res = await client.fetch(args.url, init);
  const text = await res.text();
  const envelope: FetchToolResultBody = {
    status: res.status,
    signature: res.headers.get("x-payment-signature") ?? null,
    body: tryJson(text),
  };
  return {
    content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
  };
}

/**
 * Run the px402_balance tool against a client. Exported for testing.
 */
export async function handleBalance(client: Px402ClientLike): Promise<McpToolResult> {
  const balance = await client.balance();
  return {
    content: [{ type: "text", text: JSON.stringify(balance, null, 2) }],
  };
}

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
  /** Override the 402-retry schedule. Default tuned for mainnet (~30s total). */
  retryDelaysMs?: number[];
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
    ...(cfg.retryDelaysMs ? { retryDelaysMs: cfg.retryDelaysMs } : {}),
  });

  const server = new McpServer({
    name: "px402",
    version: "0.0.1",
  });

  server.tool(
    "px402_fetch",
    "Call a paid API. Automatically pays with USDC on a 402 response and returns the final body.",
    fetchInputSchema,
    (args) => handleFetch(client, args as FetchToolArgs),
  );

  server.tool(
    "px402_balance",
    "Read the agent wallet's base-chain USDC balance.",
    {},
    () => handleBalance(client),
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
