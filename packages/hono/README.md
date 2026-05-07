# @px402/hono

[Hono](https://hono.dev) middleware for [px402](https://github.com/Allen-Saji/px402). Gate API routes behind private agent payments — agents pay USDC on Solana via MagicBlock PER, and the recipient stays hidden.

## Install

```sh
pnpm add @px402/hono @px402/core
```

## Minimal server

```ts
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { px402 } from "@px402/hono";
import { PrivateTransferSubscriber, deriveQueuePda } from "@px402/core";

const SERVER_WALLET = "6dRPtBVYiJ6iM7eQqDzCQpBDACBzYoZjGqostfZqrgGU";
const MINT = "5CmxDcDtDiqwxy9TDVyo1Xjr4AFwQzrH7vKr8cXfkEse";
const VALIDATOR = "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57";

const subscriber = new PrivateTransferSubscriber({
  rpcUrl: "https://devnet.magicblock.app",
  queuePda: deriveQueuePda(MINT, VALIDATOR).toBase58(),
  receiverWallet: SERVER_WALLET,
  commitment: "finalized", // ER commitment is INVERTED: "finalized" = newest
});
await subscriber.start();

const app = new Hono();

app.use(
  "*",
  px402({
    serverSecret: process.env.PX402_SERVER_SECRET!, // 32+ bytes hex
    paymentAddress: SERVER_WALLET,
    pricing: {
      "/api/sentiment": "10000", // 0.01 USDC
      "/api/whales":    "20000",
    },
    subscriber,
    onVerified: (e) => console.log("paid:", e.path, e.signature),
  }),
);

app.get("/api/sentiment", (c) => c.json({ sentiment: "bullish" }));

serve({ fetch: app.fetch, port: 8787 });
```

## What the middleware does

1. Sees no `X-Payment-Id` header → returns 402 with the price + a server-signed token (`X-Payment-Token`).
2. Sees a paid retry → matches the agent's transfer against `subscriber` by `clientRefId`, verifies amount, prevents replay, then `next()`s.

The middleware is stateless across requests; the subscriber holds the verified-transfer index.

## Config

```ts
interface Px402HonoConfig {
  serverSecret: string | { current: string; previous?: string };
  paymentAddress: string;       // server wallet pubkey
  pricing: Record<string, string>; // path -> micro-USDC
  subscriber: SubscriberLike;
  tokenTtlMs?: number;          // default 5 min
  replayWindowMs?: number;      // default 10 min
  rateLimit?: { issuePerIpPerMinute?: number; verifyPerWalletPerMinute?: number };
  network?: string;             // default "solana-per"
  currency?: string;            // default "USDC"
  onVerified?: (e: VerifiedEvent) => void;
}
```

## Reference server

[`apps/demo-apis`](https://github.com/Allen-Saji/px402/tree/main/apps/demo-apis) is a working Hono server using this middleware with three priced routes.

## License

MIT
