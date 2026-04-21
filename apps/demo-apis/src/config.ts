import { randomBytes } from "node:crypto";

export interface DemoConfig {
  port: number;
  serverSecret: string;
  destinationWallet: string;
  destinationAta: string;
  mint: string;
  baseRpcUrl: string;
  ephemeralRpcUrl: string;
  ephemeralWsUrl: string;
  pricing: Record<string, string>;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env var ${name}`);
  }
  return v;
}

function toWsUrl(httpUrl: string): string {
  if (httpUrl.startsWith("wss://") || httpUrl.startsWith("ws://")) return httpUrl;
  return httpUrl.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
}

export function loadConfig(): DemoConfig {
  const serverSecret = process.env.PX402_SERVER_SECRET;
  if (!serverSecret && process.env.NODE_ENV === "production") {
    throw new Error(
      "PX402_SERVER_SECRET is required in production. Refusing to auto-generate.",
    );
  }

  const ephemeralRpcUrl =
    process.env.PX402_EPHEMERAL_RPC_URL ?? "https://devnet.magicblock.app";
  const ephemeralWsUrl = process.env.PX402_EPHEMERAL_WS_URL ?? toWsUrl(ephemeralRpcUrl);

  return {
    port: Number(process.env.PORT ?? 8787),
    serverSecret: serverSecret ?? randomBytes(32).toString("hex"),
    destinationWallet: required("PX402_DESTINATION_WALLET"),
    destinationAta: required("PX402_DESTINATION_ATA"),
    mint: required("PX402_MINT"),
    baseRpcUrl: process.env.PX402_BASE_RPC_URL ?? "https://rpc.magicblock.app/devnet",
    ephemeralRpcUrl,
    ephemeralWsUrl,
    pricing: {
      "/api/sentiment": process.env.PX402_PRICE_SENTIMENT ?? "10000",
    },
  };
}
