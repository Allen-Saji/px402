import { randomBytes } from "node:crypto";

export interface DemoConfig {
  port: number;
  serverSecret: string;
  /** Server's wallet pubkey. Used as X-Payment-Address and as the receiver filter. */
  paymentAddress: string;
  mint: string;
  cluster: string;
  apiUrl: string;
  baseRpcUrl: string;
  ephemeralRpcUrl: string;
  ephemeralWsUrl: string;
  validator: string;
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
    paymentAddress: required("PX402_PAYMENT_ADDRESS"),
    mint: required("PX402_MINT"),
    cluster: process.env.PX402_CLUSTER ?? "devnet",
    apiUrl: process.env.PX402_API_URL ?? "https://payments.magicblock.app",
    baseRpcUrl: process.env.PX402_BASE_RPC_URL ?? "https://rpc.magicblock.app/devnet",
    ephemeralRpcUrl,
    ephemeralWsUrl,
    validator: process.env.PX402_VALIDATOR ?? "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57",
    pricing: {
      "/api/sentiment": process.env.PX402_PRICE_SENTIMENT ?? "10000",
      "/api/whales": process.env.PX402_PRICE_WHALES ?? "20000",
      "/api/risk": process.env.PX402_PRICE_RISK ?? "30000",
    },
  };
}
