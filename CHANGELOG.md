# Changelog

All notable changes to px402 will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-rc.0] — 2026-05-13

First production-ready cut. Hardens the subscriber for crash recovery,
formalizes shutdown semantics, types out the unsafe fund-moving paths,
and documents what's deliberately out of scope.

### Added

- **`@px402/core`**: async `subscriber.stop(timeoutMs?)` that awaits
  in-flight polls and aborts pending RPC fetches via `AbortController`
  before resolving. After `stop()` resolves, no further
  `tick` / `error` / `stalled` events fire.
- **`@px402/core`**: `subscriber.getWatermark()` getter and
  `onWatermarkAdvance(sig)` config callback for crash-safe state.
  Persist the watermark on each advance, then pass back via
  `initialWatermark` on the next boot to backfill payments landed
  during the crash window.
- **`@px402/core`**: documented observability events
  (`ready` / `tick` / `error` / `stalled`) with Sentry / Datadog
  wiring examples and a 30s stall threshold for alerting.
- **`@px402/client`**: `Px402DepositError` and `Px402WithdrawError`
  with `phase` (`build` / `submit` / `confirm`) and `partialSignature`
  fields so adopters can tell whether a retry is safe.
- **`@px402/mcp`**: pure-function tool handlers (`handleFetch`,
  `handleBalance`) exported for testing, plus 15 unit tests covering
  envelope shapes, schema validation, and error propagation.
- **Docs**: `docs/operations/rotate-server-secret.md` — zero-downtime
  HMAC key rotation using `serverSecret: { current, previous }`.
- **Docs**: `KNOWN_LIMITATIONS.md` — explicit v0.2 roadmap stub
  (multi-tenant subscriber, multi-RPC pool, persisted verified-tick
  state) with workarounds for each.
- **Tooling**: `scripts/soak.ts` — 1-hour subscriber soak harness
  against live MagicBlock devnet. Samples RSS / heap / FD / subscriber
  state every 60s, writes CSV, and reports MB/hour leak slope.

### Changed

- All packages bumped to `0.1.0-rc.0`.
- All scoped packages now ship with `"publishConfig": { "access": "public" }`
  so a free npm token can publish them.
- `subscriber.stop()` is now async — callers in `apps/demo-apis` and the
  integration suite await it before shutting down. **Breaking change vs
  0.0.1**, though 0.0.1 was never published to npm.
- Hono / Express / Next READMEs document `Retry-After` as whole seconds
  per [RFC 6585](https://datatracker.ietf.org/doc/html/rfc6585#section-4).

### Fixed

- Subscriber no longer emits `error` or `stalled` after `stop()` is
  called — abort-related rejections in in-flight fetches are swallowed
  silently so adopters don't see spurious telemetry on shutdown.

## [0.0.1] — 2026-05-08 (unpublished)

Initial monorepo with `@px402/{core, hono, express, next, client, mcp}`,
landing page, 73 unit tests + 10 real-devnet integration scenarios,
stress harness, and per-package READMEs. Verified end-to-end against
MagicBlock devnet: ~4s single-payment, 96.7% at 30 concurrent.
