# @px402/express

[Express](https://expressjs.com) middleware for [px402](https://github.com/Allen-Saji/px402). Gate API routes behind private agent payments — agents pay USDC on Solana via MagicBlock PER, and the recipient stays hidden.

## Install

```sh
pnpm add @px402/express @px402/core
```

## Minimal server

```ts
import express from "express";
import { px402 } from "@px402/express";
import { PrivateTransferSubscriber, deriveQueuePda } from "@px402/core";

const SERVER_WALLET = "6dRPtBVYiJ6iM7eQqDzCQpBDACBzYoZjGqostfZqrgGU";
const MINT = "5CmxDcDtDiqwxy9TDVyo1Xjr4AFwQzrH7vKr8cXfkEse";
const VALIDATOR = "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57";

const subscriber = new PrivateTransferSubscriber({
  rpcUrl: "https://rpc.magicblock.app/devnet", // base RPC
  queuePda: deriveQueuePda(MINT, VALIDATOR).toBase58(),
  mint: MINT,
  receiverWallet: SERVER_WALLET,
});
await subscriber.start();

const app = express();

app.use(
  px402({
    serverSecret: process.env.PX402_SERVER_SECRET!,
    paymentAddress: SERVER_WALLET,
    pricing: { "/api/sentiment": "10000" },
    subscriber,
  }),
);

app.get("/api/sentiment", (req, res) => {
  res.json({ sentiment: "bullish" });
});

app.listen(8787);
```

## What the middleware does

1. No `X-Payment-Id` → returns 402 with price + signed token.
2. Paid retry → verifies via subscriber by `clientRefId`, then `next()`.

Stateless across requests; subscriber holds the verified-transfer index.

## Config

`Px402ExpressConfig` extends [`Px402CoreConfig`](../core) with the same fields as the [Hono adapter](../hono):

```ts
{
  serverSecret: string | { current: string; previous?: string };
  paymentAddress: string;
  pricing: Record<string, string>;
  subscriber: SubscriberLike;
  tokenTtlMs?, replayWindowMs?, rateLimit?, network?, currency?
}
```

## Rate limiting

On 429, the middleware sets `Retry-After` in whole seconds per
[RFC 6585](https://datatracker.ietf.org/doc/html/rfc6585#section-4). Clients
that respect the header back off correctly; `@px402/client` does this
automatically.

## Reading client IP

The middleware reads `x-forwarded-for` (first hop), then `x-real-ip`, then `req.ip`. If you're behind a proxy, set `app.set("trust proxy", true)`.

## License

MIT
