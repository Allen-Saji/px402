# Known limitations and v0.2 roadmap

px402 0.1.0 is the **production-ready first cut** of the protocol. It's been
hardened with graceful shutdown, crash-safe watermark persistence,
RFC 6585-conformant rate limiting, observability hooks, and typed retry
semantics for fund-moving operations. Everything below is **deliberately
out of scope for 0.1** because it would either over-fit to a use case
that no current adopter needs, or it requires upstream support that
doesn't exist yet.

If any of these block your adoption, file an issue and we'll prioritize.

## Out of scope for 0.1.0

### Multi-tenant subscriber

Today one `PrivateTransferSubscriber` listens on one `receiverWallet`. If
you're running a B2B SaaS that resells multiple downstream APIs each with
its own payment address (RapidAPI-shaped), you'd want one subscriber
indexing many receivers.

**Why deferred:** Every v0.1 adopter (Coinbase x402, Skyfire, Catena,
Crossmint, SendAI, etc.) has exactly one receiver. The structural change
to support N adds complexity — multi-receiver crank polling, per-receiver
clientRefId namespacing, per-tenant rate-limit buckets — without paying
back for any current user.

**Workaround for v0.1:** Spin up one subscriber instance per tenant. Memory
overhead is small (each subscriber holds a bounded watermark + TTL index).

### Multi-RPC pool with health-checking

The subscriber polls a single `rpcUrl`. If your MagicBlock RPC has a
sustained outage, the `stalled` event fires after 30s and you have to
redeploy with a new env var to swap endpoints.

**Why deferred:** Most production deploys front their MagicBlock endpoint
with Helius or Triton, which handle failover internally. Building px402's
own multi-endpoint pool duplicates that.

**Workaround for v0.1:**
1. Alert on the `stalled` event.
2. Persist the watermark (see `packages/core/README.md`).
3. Redeploy with a new `rpcUrl` — no payments dropped during the swap.

### Crash-safe state for in-flight verifications

Crash-safe **watermark** persistence ships in 0.1 (so the subscriber can
resume from where it left off). But the **in-memory clientRefId index**
between `tick` and `verify` is not persisted. If the server crashes
between receiving a `tick` and the agent retrying, that single payment's
verification has to come from a backwards-scan after restart.

This is mostly fine in practice: the agent's retry window
(`MAX_RETRIES × backoff` ~3–5s) plus the post-restart backfill window
covers normal crash recovery. It's only an issue for crashes longer than
the agent's retry budget.

**Why deferred:** The right shape (Redis-backed verified-tick index? SQLite?)
depends on the adopter's existing storage stack. Adding a built-in
persistence layer with one opinionated choice creates more friction than
the problem it solves for most adopters.

**Workaround for v0.1:** Persist the watermark + accept that a sub-second
crash during the pay-then-retry window means the agent will retry once
more after backfill. The token TTL (5 min default) covers this comfortably.

### Devnet crank cadence vs default client retry window

After the 2026-05-13 MagicBlock protocol change moved crank execution to
the base chain (`ExecuteReadyQueuedTransfer`), devnet crank latency has
been observed to spike well past the `@px402/client` default retry budget
(~30s across 4 attempts). When this happens, the client throws
`MaxRetriesExceededError` even though the subscriber later catches the
tick correctly.

**Why deferred:** Crank cadence is a MagicBlock-side knob, not a px402
code path. Mainnet cadence is expected to be sub-second; devnet is best
effort.

**Workaround for v0.1:** Adopters whose target traffic includes devnet
should configure `Px402Client` with a longer `retryDelaysMs` array
(e.g. `[2000, 4000, 8000, 16000, 32000, 64000]`) so the client waits long
enough for a slow crank to fire.

### `tokenTtlMs` honored, `STALLED_THRESHOLD_MS` not

`tokenTtlMs` is configurable. The subscriber's "no successful poll for X
ms = stalled" threshold (`STALLED_THRESHOLD_MS = 30000`) is currently a
compile-time constant. If your alerting cadence wants different
sensitivity, you'd need to fork.

**Why deferred:** Cheap to add. Just hasn't surfaced as a real ask yet.
Open an issue if you need it.

## What ships in 0.1.0

For comparison — these are NOT limitations; they're explicitly supported:

- Async graceful shutdown with AbortController drain (`subscriber.stop()`)
- Crash-safe watermark persistence (`onWatermarkAdvance` callback + `initialWatermark` config)
- `error` + `stalled` event hooks for Sentry/Datadog wiring
- RFC 6585 `Retry-After` on 429
- Token rotation with `serverSecret: { current, previous }` overlap
- Typed `Px402DepositError` / `Px402WithdrawError` with `phase` + `partialSignature` for safe retry
- 1-hour soak validation (see `SOAK.md`)
- Single-RPC failure model with documented operator runbook
