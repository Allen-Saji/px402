#!/usr/bin/env node
/**
 * Entry point for the `px402-mcp` CLI. Run under a Claude Desktop MCP server
 * config or a local `tsx` dev run.
 *
 * Env vars:
 *   PX402_KEYPAIR_PATH    absolute path to a Solana keypair .json file
 *   PX402_MINT            SPL mint accepted for payments
 *   PX402_API_URL         optional REST base
 *   PX402_BASE_RPC_URL    optional
 *   PX402_EPHEMERAL_RPC_URL  optional
 *   PX402_CLUSTER         "devnet" or "mainnet"
 */
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import { createPx402McpServer, runStdio } from "./server.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

async function main() {
  const keypairPath = required("PX402_KEYPAIR_PATH");
  const mint = required("PX402_MINT");

  const secret = Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")) as number[]);
  const wallet = Keypair.fromSecretKey(secret);

  const server = createPx402McpServer({
    wallet,
    mint,
    ...(process.env.PX402_API_URL ? { apiUrl: process.env.PX402_API_URL } : {}),
    ...(process.env.PX402_BASE_RPC_URL ? { baseRpcUrl: process.env.PX402_BASE_RPC_URL } : {}),
    ...(process.env.PX402_EPHEMERAL_RPC_URL
      ? { ephemeralRpcUrl: process.env.PX402_EPHEMERAL_RPC_URL }
      : {}),
    ...(process.env.PX402_CLUSTER ? { cluster: process.env.PX402_CLUSTER } : {}),
  });

  await runStdio(server);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
