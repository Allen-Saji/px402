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
const MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"; // Circle devnet USDC (faucet.circle.com)
const VALIDATOR = "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57";

const subscriber = new PrivateTransferSubscriber({
  rpcUrl: "https://rpc.magicblock.app/devnet", // base RPC
  queuePda: deriveQueuePda(MINT, VALIDATOR).toBase58(),
  mint: MINT,
  receiverWallet: SERVER_WALLET,
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

## Rate limiting

On 429, the middleware sets `Retry-After` in whole seconds per
[RFC 6585](https://datatracker.ietf.org/doc/html/rfc6585#section-4). Clients
that respect the header back off correctly; `@px402/client` does this
automatically.

## Reference server

[`apps/demo-apis`](https://github.com/Allen-Saji/px402/tree/main/apps/demo-apis) is a working Hono server using this middleware with three priced routes.

## License

MIT
