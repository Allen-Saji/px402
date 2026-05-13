# @px402/next

[Next.js](https://nextjs.org) App Router wrapper for [px402](https://github.com/Allen-Saji/px402). Gate route handlers behind private agent payments — agents pay USDC on Solana via MagicBlock PER, and the recipient stays hidden.

## Install

```sh
pnpm add @px402/next @px402/core
```

## Minimal route

```ts
// app/api/sentiment/route.ts
import { NextResponse } from "next/server";
import { withPx402 } from "@px402/next";
import { PrivateTransferSubscriber, deriveQueuePda } from "@px402/core";

const SERVER_WALLET = "6dRPtBVYiJ6iM7eQqDzCQpBDACBzYoZjGqostfZqrgGU";
const MINT = "5CmxDcDtDiqwxy9TDVyo1Xjr4AFwQzrH7vKr8cXfkEse";
const VALIDATOR = "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57";

// Hoist + start once. Persist across hot reloads in dev with the global cache trick.
const subscriber = new PrivateTransferSubscriber({
  rpcUrl: "https://devnet.magicblock.app",
  queuePda: deriveQueuePda(MINT, VALIDATOR).toBase58(),
  receiverWallet: SERVER_WALLET,
  commitment: "finalized", // ER commitment is INVERTED: "finalized" = newest
});
void subscriber.start();

export const GET = withPx402(
  {
    serverSecret: process.env.PX402_SERVER_SECRET!,
    paymentAddress: SERVER_WALLET,
    pricing: { "/api/sentiment": "10000" },
    subscriber,
  },
  async (req) => {
    const token = new URL(req.url).searchParams.get("token") ?? "SOL";
    return NextResponse.json({ token, sentiment: "bullish" });
  },
);
```

## Caveats

- **App Router only.** No Pages Router support. The wrapper depends on `NextRequest` / `NextResponse`.
- **Long-running subscriber.** `PrivateTransferSubscriber` runs continuously and polls the ER queue PDA. **It will not work on Vercel serverless** (functions are ephemeral). Run on a long-lived Node process: Railway, Fly, Render (paid tier — free tier sleeps), or self-hosted.
- **Hot reloads.** In dev, hoist the subscriber on `globalThis` to avoid spawning a new poller per route file.

## Rate limiting

On 429, the wrapper sets `Retry-After` in whole seconds per
[RFC 6585](https://datatracker.ietf.org/doc/html/rfc6585#section-4). Clients
that respect the header back off correctly; `@px402/client` does this
automatically.

## Config

`Px402NextConfig` is the same as [`HandlerConfig`](../core) from `@px402/core`. See the [Hono README](../hono) for the full field reference — Next inherits the same shape.

## License

MIT
