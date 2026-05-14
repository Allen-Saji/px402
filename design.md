---
tags: [project, solana, magicblock, x402, protocol]
created: 2026-04-21
modified: 2026-05-14
status: live
---

# px402: Private x402 Protocol for Agent Payments

Live protocol design doc. Architecture locked 2026-04-21, amended 2026-05-13 after MagicBlock's crank protocol changed (see [2026-05-13 amendment](#2026-05-13--protocol-change-amendment) at bottom).

For the user-facing protocol surface — headers, payment body, retry semantics — see [README.md](./README.md), kept fresh as the published reference. This doc covers the *why* behind the decisions.

## Snapshot

- **Problem:** x402 payments on public Solana leak the agent's consumption pattern.
- **Solution:** Route payments through MagicBlock's private rails (TEE shuttle + base-chain settlement). Same 402 flow; the agent→recipient link is broken.
- **Verification:** Subscriber polls base RPC for `ExecuteReadyQueuedTransfer` instructions on the queue PDA; matches `client_ref_id` from the program log; sender / receiver / amount from `meta.pre/postTokenBalances` deltas filtered by mint.
- **Adoption:** `@px402/{core,hono,express,next,client,mcp}` on npm.

## Problem statement

x402 is the emerging standard for agent-to-API payments on Solana. Agent hits endpoint, gets 402, pays USDC, gets content. Backed by Linux Foundation with Google, AWS, Visa, Stripe as members; 140M+ transactions processed.

Every public x402 payment is a public Solana transaction. Anyone watching the blockchain can see:

- Which APIs an agent consumes (competitive intelligence)
- How much it pays per call (pricing intelligence)
- How frequently it calls each service (usage pattern)
- The agent's total API spend and budget allocation

For trading agents, research agents, or any agent with a strategy, this is a leak. The API consumption pattern *is* the strategy. Public x402 is like running the playbook on a jumbotron.

px402 routes payments through MagicBlock's TEE shuttle so that the agent's deposit and the eventual settlement appear on chain as unlinkable transactions. Same 402 flow, same developer experience.

## What's public, what's hidden

The privacy claim is precise — not "invisible on mainnet", but "unlinkable".

**Public on Solana (base chain):**
- Sender wallet of the agent's deposit tx
- Mint and amount on the deposit tx
- Settlement tx: validator-signed `ExecuteReadyQueuedTransfer`, receiver ATA, mint, amount

**Hidden:**
- Which deposit corresponds to which settlement — the TEE controls that mapping; it is not derivable from on-chain state alone
- Therefore: an outside observer cannot tell *which API* the agent is paying, even though every constituent fact is public

Agent strategy stays hidden because the *link* — not the events — is what carries the strategic signal.

## Architecture decisions

| # | Decision | Why | Alternative considered |
|---|----------|-----|------------------------|
| 1 | **`clientRefId`-based verification via base-chain polling.** Subscriber polls `getSignaturesForAddress` on the base RPC, filters `ExecuteReadyQueuedTransfer` from the SPL-PP CPI, reads `client_ref_id` from the program log, reads sender / receiver / amount from `meta.preTokenBalances` / `meta.postTokenBalances` deltas. | The 2026-05-13 protocol change collapsed the old insert+pop two-tx model into a single base-chain settlement tx that carries the full payload. O(1) lookup, no log-truncation workaround needed. | Memo on PER transfer (original design — became infeasible when the crank moved off ER); FIFO slot + balance-delta (broken under out-of-order arrival); unique PDA per payment (2x setup cost) |
| 2 | **Stateless server with HMAC-signed payment tokens.** Server issues token encoding `{paymentId, amount, expiry, path, destination, hmac}`; client returns token; server re-verifies HMAC + subscriber lookup. | Adopters do not need Postgres. | In-memory pending set, Postgres-backed |
| 3 | **IP + per-wallet rate limiting in core middleware.** | Unauthenticated payment-id issuance is a DoS vector even with HMAC. IP limit always on; wallet limit active after first successful payment. | Proof-of-wallet on issuance (hurts DX), WAF only (adopter liability) |
| 4 | **Core + Hono + Express + Next.js App Router adapters.** | Adapter breadth is the adoption story. Coinbase x402 middleware ships multiple adapters for the same reason. | Hono-only, bundled server package |
| 5 | **Deposit via SDK + CLI + MCP tool.** | Three user types, three surfaces. All three wrap the same core flow. | MCP-only (non-MCP agents blocked), auto-deposit (magic, risks runaway spend) |
| 6 | **Monorepo: packages per concern + apps dir.** | Matches Coinbase x402 layout. Each package publishes independently. | Bundled server, single package with subpath exports |
| 7 | **Npm scope `@px402`.** | Clean namespacing, free for public packages. | Unscoped `px402-` prefix |
| 8 | **HMAC secret: env var + auto-gen dev + two-key rotation buffer.** | Two keys live during the rotation window so in-flight payments do not drop. Matches Rails / Django / Laravel session-secret pattern. | Env-only hard-fail, derived from wallet keypair |
| 9 | **Subscriber polls instead of subscribing.** `getSignaturesForAddress` on base RPC with an `until` watermark; parallel `getTransaction` fetches; three-phase apply (fetch → parse → sorted apply by `slot, txOrder`). Crash-safe via `onWatermarkAdvance` callback. | Tried `logsSubscribe` on MagicBlock ER first — subscriptions accepted but no notifications delivered. Polling is the only path that ships. | Persistent WebSocket subscriber (original design — never worked against MagicBlock ER); polling per HTTP retry (couples verification latency to client retry cadence) |
| 10 | **Configurable retry budget.** `Px402Client` default targets mainnet sub-second cadence; devnet adopters override via `retryDelaysMs`. | Devnet crank cadence is bounded by MagicBlock's validator schedule (~4 min as of 2026-05-13); mainnet target is sub-second. One default cannot serve both surfaces. | Single fixed schedule (would either fail on devnet or oversleep on mainnet) |

## Empirical findings

### Live measurements (post-2026-05-13 protocol change)

| Metric | Value | Source |
|--------|-------|--------|
| Devnet crank cadence (agent deposit → `ExecuteReadyQueuedTransfer` on base) | ~4 min | 19 historical + 4 fresh ticks observed 2026-05-13 |
| Mainnet crank cadence | sub-second target, **not yet verified** | docs.magicblock.gg |
| Single-payment integration test (test 01) | bounded by crank cadence; current ceiling 600s | `01-single-payment.test.ts` |
| Replay-attack test (test 10, 2 payments + 409 retry) | 334s | session 2026-05-13 |
| Amount-mismatch test (test 08, 1 payment + verify) | 81s | session 2026-05-13 |
| Server smoke (express / next / mcp) | 235-244s | session 2026-05-13 |
| Subscriber poll cycle | 500ms with 16 parallel `getTransaction` fetches | `packages/core/src/subscribe.ts` |

### Pre-protocol-change measurements (historical)

| Metric | Value (pre-2026-05-13) |
|--------|------------------------|
| ER block time | ~50ms/slot, 20 slots/sec |
| `logsSubscribe` inter-arrival p90 | 49ms — but subscriptions on MagicBlock ER accepted with no notifications delivered; the trace was from a parallel probe |
| Observed ER throughput | 97 txs/sec |
| Memo tx size overhead | +61 bytes (+24.9%) — memo no longer used as the identifier |
| Full base-chain tx confirm | ~1.8s |
| `signatureSubscribe` on ER | supported, 101ms ACK |

### ER commitment gotcha (unchanged)

On MagicBlock ER, at any given moment:

```
processed ≤ confirmed ≤ finalized  (in slot number)
absoluteSlot > blockHeight > finalized
```

Opposite of mainnet Solana where `processed` is the newest. Likely because ER uses a single validator (no voting). The subscriber reads base RPC where ordering is normal. The inversion only matters for the parts of the client SDK that read ER (`privateBalance`, send-to-ephemeral confirms).

## Protocol specification

The wire-level surface — headers, body, retry semantics — lives in [README.md](./README.md#protocol). This section covers the parts that do not fit in the README.

### High-level flow

```
1. Agent     → Server:          GET /api/data
2. Server    → Agent:           402 + payment token
                                (HMAC over {paymentId, amount, expiry, path, destination})
3. Agent     → MagicBlock REST: POST /v1/spl/transfer
                                (fromBalance=base, toBalance=base, clientRefId=u63)
   Agent     → Base RPC:        sendRawTransaction
   ─────────  (TEE shuttle: deposit enqueued in queue PDA;
                later, validator cranks settlement on base)
4. Validator → Base chain:      ExecuteReadyQueuedTransfer
                                (logs `client_ref_id: <u64>`;
                                 balance deltas carry sender / receiver / amount)
5. Subscriber observes (4) on base RPC poll cycle; indexes by clientRefId
6. Agent     → Server:          retry GET /api/data + X-Payment-Id + X-Payment-Token
7. Server    → Subscriber:      lookupByClientRefId(paymentId)
   Server    → Agent:           200 + data + X-Payment-Signature (settlement tx)
```

Steps 3 and 4 are asynchronous: the client retries step 6 while step 4 has not yet landed. The server responds `402 payment_pending` until the subscriber emits a tick matching the paymentId.

### Architecture diagram

The sequence diagram is rendered from `~/projects/diagram-kit/private/projects/Px402Animated.tsx` and shipped as [`./assets/architecture.png`](./assets/architecture.png). Re-render both when the protocol changes.

### Key differences from public x402

- `X-Payment-Network: solana-per` signals private settlement
- `X-Payment-Id` is a decimal u63, echoed verbatim as `clientRefId` on the transfer
- `X-Payment-Address` is the server's **wallet pubkey** (not its ATA — the REST API derives the ATA itself)
- `X-Payment-Token` is an HMAC-signed payload carrying all server state — no database needed
- Verification is a `clientRefId` lookup against an in-memory subscriber index, not an on-chain memo read
- Client retries with the same paymentId until verified or until the token TTL elapses (5 min default)

## Package layout

```
~/px402/
├── packages/
│   ├── core/                 # @px402/core
│   │   ├── src/
│   │   │   ├── token.ts      # HMAC sign / verify, rotation buffer
│   │   │   ├── verify.ts     # subscriber lookup, replay prevention
│   │   │   ├── rate-limit.ts # IP + per-wallet buckets
│   │   │   ├── subscribe.ts  # base-chain polling subscriber
│   │   │   └── types.ts
│   ├── hono/                 # @px402/hono
│   ├── express/              # @px402/express
│   ├── next/                 # @px402/next
│   ├── client/               # @px402/client
│   └── mcp/                  # @px402/mcp
├── apps/
│   └── demo-apis/            # 3 priced routes under @px402/hono
└── examples/
    ├── server-express/
    ├── server-next/
    ├── mcp-smoke/
    └── agent/
```

## Test surface

### Unit (core, ~70 cases)

- `createPaymentToken` / `verifyPaymentToken` — HMAC happy paths, tamper, expiry, key rotation
- `verify` — clientRefId match + amount match → verified; not yet indexed → pending; amount mismatch → InvalidPayment; replay → ReplayError
- Rate limiter — IP / wallet bucket semantics
- Subscriber — fresh tick parsing, multi-tick batch ordering, watermark advance / hold-on-failure, abort on stop

### Integration (10 scenarios, devnet, gated on `PX402_DEVNET=1`)

Detailed list in [`tests/integration/README.md`](./tests/integration/README.md). Highlights:

- 01: single payment smoke
- 04: 10 concurrent distinct wallets — concurrency regression
- 05: 30-payment burst — stress baseline
- 07-10: HTTP-edge security paths (TTL expiry, amount mismatch, tampered token, replay)

Test 06 (subscriber-lag / orphan-pop recovery) is architecturally obsolete in the single-tx model; kept until deletion lands.

### Smokes (per-adapter)

`examples/server-express/`, `examples/server-next/`, `examples/mcp-smoke/` — each pays one priced route on devnet end-to-end. Used as the adapter regression suite.

## Error handling

| Scenario | Response | Resolution |
|----------|----------|------------|
| Insufficient base-USDC balance | client throws `Px402TransferError` | Agent tops up via `client.deposit()` or external transfer |
| Deposit landed, settlement not yet cranked | `402 payment_pending` | Client retries per `retryDelaysMs` until subscriber emits the tick |
| Token TTL elapsed mid-retry | `402 reason: "expired"` + fresh paymentId | Client pays again with the new id |
| HMAC tamper or mismatched id / path / amount / destination | `401` | Client did not receive this token from this server |
| Same tx signature replayed | `409 replay` | Client cannot reuse a settled paymentId |
| Two agents pay simultaneously to same server | both verify independently | `clientRefId` namespaces the index — no ordering dependency |
| Rate limit | `429 + Retry-After` | Client respects header, retries |
| Subscriber stalled (>30s no successful poll) | `stalled` event fires | Operator alerts; redeploy with a new `rpcUrl` if needed |
| MagicBlock REST returns stale blockhash | client transparently retries `postBuild` up to 3× | No adopter-visible error |

## Out of scope (for 0.1)

See [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md) for the live list. Major exclusions:

- Multi-tenant subscriber (one `receiverWallet` per instance)
- Multi-RPC pool with health-checking
- Persisted in-flight verification state (watermark is persisted; clientRefId index is not)
- x402 fallback for non-PER clients
- Pages Router (Next adapter is App Router only)
- Non-USDC tokens (devnet USDC mint only)

## Dependencies

- MagicBlock Private Payments REST API (devnet + production)
- `@magicblock-labs/ephemeral-rollups-sdk`
- `@solana/web3.js`, `@solana/spl-token`
- `hono`, `express`, `next`
- `@modelcontextprotocol/sdk`
- `zod` (config validation)

Removed since the 2026-05-13 amendment: `ws` (WebSocket client — `logsSubscribe` path abandoned); `ulidx` (paymentId is u63, not ULID).

## Devnet bootstrap state

| Artifact | Value |
|----------|-------|
| Test USDC mint | `5CmxDcDtDiqwxy9TDVyo1Xjr4AFwQzrH7vKr8cXfkEse` |
| Decimals | 6 |
| Mint keypair | `~/.config/solana/px402-usdc-mint.json` |
| Mint authority | Allen's base wallet `3wBhCBpCudbtfdaGdBRWhjsRq9B2yAkAgKadjJkVdAiA` |
| PER validator | `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57` |
| PER transfer queue PDA | `4dA398Eh9P61oGLqebRTYEQD7n4HvwxButoU5NM9C2gu` |
| Delegation program | `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` |
| SPL-PP program | `SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2` |
| Server keypair | `~/.config/solana/px402-server.json` (auto-gen on first integration run) |

## Engineering review trail

### 2026-04-21 — original review

All 6 architectural issues from the original draft were resolved:

1. Balance-delta verification was broken under out-of-order arrival → replaced with memo-based verification
2. Memo test ran on live devnet; PER REST accepted `memo` field; ER RPC returned it on `getSignaturesForAddress`
3. DoS on payment-id issuance → IP + per-wallet rate limit in core middleware
4. Server state → stateless via HMAC-signed payment tokens (no Postgres dependency)
5. Framework coupling → core + Hono + Express + Next.js App Router adapters
6. Agent deposit UX → SDK + CLI + MCP surfaces

Performance: `logsSubscribe` WebSocket chosen for a sub-50ms verification narrative. Client retry: 500ms / 1s / 2s / fresh.

### 2026-05-13 — protocol-change amendment

Between 2026-05-08 and 2026-05-13, MagicBlock moved the crank from ER (`ProcessTransferQueueTick` on a `Crank11…` program) to base chain (`ExecuteReadyQueuedTransfer` signed by validator `MAS1…k57` through delegation program `DELeGG…eSh` → SPL-PP CPI). This invalidated every assumption in the original Decision Row 1 + Row 9.

**Findings:**

- Same queue PDA on both chains; the SDK's shuttle abstraction delegates an ER copy of the queue, but the actual settlement-observable tx now lands on base.
- `client_ref_id` is still emitted as a program log line on the settlement tx; sender / receiver / amount come from `meta.pre/postTokenBalances` filtered by mint.
- The original log-truncation workaround (213-char limit on `ProcessTransferQueueTick` lines, forcing amount to be sourced from a separate `DepositAndQueueTransfer` log) no longer applies — settlement is a single tx with balance deltas.
- `logsSubscribe` was never re-tested against the base RPC; the polling subscriber is the only path that ships.

**Decisions changed:**

- Decision Row 1: memo → `clientRefId`-based verification via base-chain polling.
- Decision Row 9: persistent WebSocket subscriber → polling subscriber on base RPC.
- Decision Row 10: fixed 500ms / 1s / 2s retry → configurable `retryDelaysMs` because devnet cadence is now upstream-controlled (~4 min).
- Privacy framing tightened: "encrypted destinations" / "invisible on mainnet" → "TEE breaks the link between deposit and settlement"; sender, mint, amount remain visible on both transactions.

**Validation:**

- 19 historical ticks + 4 fresh ticks across smokes + integration tests parsed correctly under the new subscriber.
- Smoke runs against express / next / mcp adapters: all PASS on devnet (236s / 235s / 244s).
- HTTP-edge integration tests (07 / 08 / 09 / 10): all PASS.

## References

- [README.md](./README.md) — published surface (kept fresh; this doc covers *why*)
- [CHANGELOG.md](./CHANGELOG.md) — release log
- [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) — current 0.1 gaps + workarounds
- MagicBlock API: https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/api-reference/per/introduction
- MagicBlock private-payments-demo: https://github.com/magicblock-labs/private-payments-demo
- x402 reference (Coinbase): https://github.com/coinbase/x402
- Colosseum Codex write-up: https://blog.colosseum.com/umbra-sdk-magicblock-private-payments-x402/
