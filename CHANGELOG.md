# Changelog

All notable changes to px402 will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **License: MIT → Apache-2.0** across all packages and the repo root.
  Apache adds an explicit patent grant (§ 3) which is the increasingly
  standard choice for protocol code. No code change required for
  consumers; the package files still ship the same source.
- **`@px402/core`**: `PrivateTransferSubscriber` rewritten for MagicBlock's
  new private-transfer flow. Between 2026-05-08 and 2026-05-13 the crank
  moved actual transfer execution from the ER queue tick to a base-chain
  `ExecuteReadyQueuedTransfer` instruction, and the old log shape
  (`ProcessTransferQueueTick group_id: ... client_ref_id: ... sender: ... receiver: ...`)
  is gone. The new subscriber polls the queue PDA on the base chain,
  filters for `Instruction: ExecuteReadyQueuedTransfer`, reads
  `client_ref_id` from the program log, and recovers `sender` / `receiver`
  / `amount` from `meta.preTokenBalances` / `meta.postTokenBalances`
  deltas filtered by mint. Net code is simpler — no insert/pop matching,
  no orphan recovery, no backwards-scan, no log-truncation workaround.
- **Breaking (`@px402/core`)**: `SubscriberConfig` now requires `mint`,
  used to filter the token-balance deltas. `rpcUrl` semantics changed:
  it must now point at the base chain RPC, not the ephemeral rollup.
- **Breaking (`@px402/core`)**: `TickEvent` no longer carries `groupId`
  or `taskId` (those fields no longer exist in the on-chain log).
- All adopters (`apps/demo-apis`, `examples/server-express`,
  `examples/server-next`) updated to wire `PX402_BASE_RPC_URL` into the
  subscriber and pass `mint`.
- `SubscriberStatus.orphanCount`, `.queuedCount`, and
  `.recentBackwardsScans` removed — those state machines are obsolete in
  the new model.

### Added

- `LICENSE`, `NOTICE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and
  `SECURITY.md` at the repo root for OSS readiness.
- `.github/` community files: issue templates (bug, feature),
  pull-request template, and Dependabot config (weekly npm + monthly
  GitHub Actions).

### Validation

Replay against real on-chain data: pointing the new subscriber at the
known-good 2026-05-13 crank batch (18 successful transfers + 1 fresh one
from a same-day smoke run) emits the expected 19 ticks with correct
`clientRefId`, `sender`, `receiver`, `amount`, and `signature`.

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
