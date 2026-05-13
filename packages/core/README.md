# @px402/core

Framework-agnostic primitives for [px402](https://github.com/Allen-Saji/px402): private agentic-payment HTTP gating on Solana via MagicBlock PER.

You usually don't install this directly. Pick a framework adapter:

- [`@px402/hono`](../hono) — Hono middleware
- [`@px402/express`](../express) — Express middleware
- [`@px402/next`](../next) — Next.js App Router wrapper

Use `@px402/core` directly only when you're writing a custom framework adapter or running the subscriber outside an HTTP server.

## Install

```sh
pnpm add @px402/core
```

## What's in here

| Export | Purpose |
|---|---|
| `createHandler(config)` | Framework-agnostic decision engine. Returns `decide(ctx)` → `{ kind: "next" }` or `{ kind: "respond", status, headers, body }`. |
| `PrivateTransferSubscriber` | Polls the MagicBlock ER queue PDA, parses `ProcessTransferQueueTick` logs, and indexes verified transfers by `clientRefId`. |
| `createPaymentToken` / `verifyPaymentToken` | HMAC-signed `v1.<payload>.<hmac>` tokens so the server stays stateless across the pay-then-retry window. |
| `verifyPayment` | Match an incoming retry against the subscriber's verified-transfer index. |
| `RateLimiter` | LRU-backed per-IP and per-wallet limiter. |
| `deriveQueuePda`, `deriveEphemeralAta`, `SPL_PP_PROGRAM_ID` | PDA helpers for MagicBlock's private payments program. |
| `normalizePath` | Strip query string and trailing slash before pricing lookup. |

## Custom adapter sketch

```ts
import { createHandler, normalizePath } from "@px402/core";

const handler = createHandler({
  serverSecret: process.env.PX402_SERVER_SECRET!,
  paymentAddress: SERVER_WALLET_PUBKEY,
  pricing: { "/api/sentiment": "10000" },
  subscriber, // a PrivateTransferSubscriber instance
});

// In your framework's request hook:
const decision = handler.decide({
  path: normalizePath(req.path),
  ip: clientIp(req),
  paymentId: req.headers["x-payment-id"],
  paymentToken: req.headers["x-payment-token"],
});

if (decision.kind === "next") {
  // payment verified or no payment required
  return next();
}
// otherwise: write decision.headers, status, body
```

## Crash-safe watermark persistence

The subscriber tracks a "watermark" — the signature of the most recent tx it
indexed on the queue PDA. On a clean boot it seeds the watermark with the
current chain tip, which means **payments that landed during a server crash or
redeploy are dropped**.

To survive restarts, persist the watermark and pass it back on the next boot:

```ts
import { PrivateTransferSubscriber, deriveQueuePda } from "@px402/core";
import { promises as fs } from "node:fs";

const WATERMARK_PATH = "/var/lib/px402/watermark";

async function loadWatermark(): Promise<string | undefined> {
  try {
    return (await fs.readFile(WATERMARK_PATH, "utf8")).trim();
  } catch {
    return undefined;
  }
}

const subscriber = new PrivateTransferSubscriber({
  rpcUrl: "https://devnet.magicblock.app",
  queuePda: deriveQueuePda(MINT, VALIDATOR).toBase58(),
  receiverWallet: SERVER_WALLET,
  initialWatermark: await loadWatermark(),
  onWatermarkAdvance: async (sig) => {
    await fs.writeFile(WATERMARK_PATH, sig);
  },
});
await subscriber.start();
```

On restart, the subscriber backfills from the persisted watermark instead of
the current tip, so a payment that landed in the crash window will be picked
up on the next poll.

The callback errors are caught and re-emitted on `error` — the subscriber
keeps polling even if your persistence layer is broken, so payment
verification doesn't stop with disk full.

`getWatermark()` is also exposed for health endpoints and external snapshotting.

## Graceful shutdown

`subscriber.stop()` is async. It signals the poll loop to halt, aborts any
in-flight RPC fetch via `AbortController`, and resolves once the current poll
has settled (or after `timeoutMs`, default 5s). Pair it with your HTTP
server's drain step:

```ts
process.on("SIGTERM", async () => {
  await subscriber.stop();
  await server.close();
  process.exit(0);
});
```

After `stop()` resolves, no further `tick` / `error` / `stalled` events
will fire.

## Errors

`InvalidTokenError`, `ExpiredTokenError`, `ReplayError` — all extend `Px402Error` with a `code` string.

## License

MIT
