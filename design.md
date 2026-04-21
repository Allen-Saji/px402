---
tags: [project, solana, magicblock, x402, hackathon, protocol]
created: 2026-04-21
modified: 2026-04-21
status: ready-to-build
hackathon: colosseum-frontier-magicblock-privacy-track
deadline: 2026-05-12
---

# px402: Private x402 Protocol for Agent Payments

Source of truth for implementation. Supersedes the original 2026-04-13 draft.
Architecture locked via engineering review on 2026-04-21.
Empirical tests against MagicBlock devnet validate the critical paths.

## Snapshot

- **Problem:** x402 payments on Solana are public. Every agent API call leaks consumption pattern and strategy.
- **Solution:** Swap the payment layer from mainnet to MagicBlock Private Ephemeral Rollups. Same 402 flow, invisible settlement.
- **Verification:** Memo on PER transfer, indexed via `getSignaturesForAddress` and `logsSubscribe`. Stateless server.
- **Adoption story:** Core + Hono + Express + Next.js App Router adapters, published as `@px402/*` on npm.
- **Target:** Colosseum Frontier + MagicBlock Privacy Track. Deadline May 12, 2026.

## Problem Statement

x402 is the emerging standard for agent-to-API payments on Solana. Agent hits endpoint, gets 402, pays USDC, gets content. 140M+ transactions processed, backed by Linux Foundation with Google, AWS, Visa, Stripe as members.

Every x402 payment is a public Solana transaction. Anyone watching the blockchain can see:

- Which APIs an agent consumes (competitive intelligence)
- How much it pays per call (pricing intelligence)
- How frequently it calls each service (usage pattern)
- The agent's total API spend and budget allocation

For trading agents, research agents, or any agent with a strategy, this is a leak. Your API consumption pattern IS your strategy. Public x402 is like running your playbook on a jumbotron.

px402 swaps the payment layer from public Solana to MagicBlock Private Ephemeral Rollups (PER). Same 402 flow, same developer experience, invisible payments. A new protocol primitive, not a wrapper.

## Why This Is Cool

- **New protocol, not a product.** px402 extends x402 with a private payment layer. Anyone can adopt it.
- **Same developer experience.** API providers add middleware. Agent developers use the client SDK. Privacy is invisible to both.
- **Stateless server.** HMAC-signed payment tokens + memo verification. No Postgres required to adopt.
- **Pattern hiding.** Agent hits 10 APIs per minute. Blockchain sees one deposit. That is the real value.
- **Works across frameworks.** Adapters for Hono, Express, Next.js App Router ship day one.

## Constraints

- Must use MagicBlock ER, PER, or Private Payments API
- Must submit to Colosseum Frontier by May 11
- Live deployment, public GitHub repo, 3-min demo video
- Solo builder, ~3 weeks remaining
- x402 integration (track explicitly lists this)

## Architecture Decisions (locked via engg review 2026-04-21)

| # | Decision | Why | Alternative considered |
|---|----------|-----|------------------------|
| 1 | **Memo-based verification** via getSignaturesForAddress / logsSubscribe | MagicBlock ER is Solana-RPC compatible and returns memo field in signature entries. O(1) payment identification, fully parallel. | FIFO slot + balance-delta (broken under out-of-order arrival), unique PDA per payment (2x on-chain setup cost) |
| 2 | **Stateless server** with HMAC-signed payment tokens | No pending_payments DB. Server issues token encoding {payment_id, amount, expiry, path, hmac}; client returns token; server re-verifies HMAC + memo. Adopters do not need Postgres. | In-memory pending set, Postgres-backed |
| 3 | **IP + per-wallet rate limiting** in core middleware | Unauthenticated payment_id issuance is a DoS vector even with HMAC. IP limit always on, wallet limit active after first successful payment. | Proof-of-wallet on issuance (hurts DX), WAF only (adopter liability) |
| 4 | **Core + Hono + Express + Next.js adapters** | 5 deliverables already committed; adapter breadth is the adoption story. Coinbase x402 middleware ships multiple adapters for same reason. | Hono-only, bundled server package |
| 5 | **Deposit via SDK + CLI + MCP tool** | Three user types, three surfaces. All three wrap same core deposit flow. | MCP-only (non-MCP agents blocked), auto-deposit (magic, risks runaway spend) |
| 6 | **Monorepo: packages per concern + apps dir** | Matches Coinbase x402 layout. Each package publishes independently. | Bundled server, single package with subpath exports |
| 7 | **Npm scope `@px402`** | Clean namespacing, free for public packages. | `px402-` unscoped prefix |
| 8 | **HMAC secret: env var + auto-gen dev + rotation buffer** | Two keys live during rotation window so in-flight payments do not drop. Matches Rails/Django/Laravel session secret pattern. | Env-only hard-fail, derived from wallet keypair |
| 9 | **Verification via logsSubscribe WebSocket at server boot** | Persistent WS connection, real-time push, O(1) in-memory lookup. Gives <50ms verification for demo narrative. | Poll getSignaturesForAddress per retry |
| 10 | **Client retry: 500ms, 1s, 2s, fresh payment_id** | Empirical measurement: chain confirmation under 400ms. First retry at 500ms succeeds in ~95% of cases. | Plan's original 2s backoff (safe but slow) |

## Empirical Findings (devnet measurements 2026-04-21)

| Metric | Value | Source |
|--------|-------|--------|
| Memo field on `POST /v1/spl/transfer` | supported | API docs + decoded unsigned tx |
| Ephemeral RPC compatibility | full Solana-core 2.2.1, magicblock-core 0.8.8 | `getVersion` |
| `getSignaturesForAddress` returns memo field | yes (Solana standard) | live RPC probe |
| ER block time | ~50ms/slot, 20 slots/sec | 6 samples across 10s |
| logsSubscribe inter-arrival p90 | 49ms | 10s trace, 971 events |
| logsSubscribe connect + subscribe ack | 543ms (one-time at boot) | WebSocket timing |
| Observed ER throughput | 97 txs/sec | trace |
| Memo tx size overhead | +61 bytes (+24.9%) | decoded actual API response |
| Memo instruction overhead | +1 ix (Memo Program), +1 account | same |
| Memo CU overhead | ~500 CUs (~10%) | SPL-memo program baseline |
| Memo fee impact | negligible inside PER (fees abstracted) | math + MagicBlock fee model |
| sendRawTransaction RTT (base chain) | ~300ms | 3 live samples |
| Full base-chain tx confirm | ~1.8s | same |
| ER sendRawTx estimate | ~200-300ms + ~100ms confirm = ~400ms | scaled by block time ratio |
| signatureSubscribe on ER | supported, 101ms ACK | live test |
| Commitment semantics on ER | **inverted** vs mainnet | `finalized` > `processed` in slot number |

### Commitment gotcha (document prominently in repo)

On MagicBlock ER, at any given moment:

```
processed ≤ confirmed ≤ finalized  (in slot number)
absoluteSlot > blockHeight > finalized
```

This is opposite of mainnet Solana where `processed` is the newest. Likely because ER uses a single validator (no voting). For px402, always use `commitment: 'finalized'` on read queries. `'confirmed'` also works and tracks `'finalized'` tightly. Avoid `'processed'` entirely on ER.

## Protocol Specification

### Standard x402 flow (public, for comparison)

```
Agent -> GET /api/data
Server -> 402 Payment Required
          X-Payment-Amount: 0.05
          X-Payment-Currency: USDC
          X-Payment-Network: solana
          X-Payment-Address: <server_solana_address>
Agent -> signs USDC transfer tx on Solana (PUBLIC)
Agent -> GET /api/data + X-Payment: <base64_signed_tx>
Server -> verifies tx on-chain
Server -> 200 OK + data
```

### px402 flow (private)

```
Agent -> GET /api/data

Server -> generates payment_id (ULID)
          constructs token payload = {payment_id, amount, expiry, path}
          signature = HMAC_SHA256(SERVER_SECRET, payload)
          token = base64(payload || signature)

Server -> 402 Payment Required
          X-Payment-Amount: 0.05
          X-Payment-Currency: USDC
          X-Payment-Network: solana-per
          X-Payment-Address: <server_per_ata>
          X-Payment-ID: <ulid>
          X-Payment-Token: <token>

Agent -> POST /v1/spl/transfer to MagicBlock API
         { from, to: server_per_ata, amount, memo: <ulid>, visibility: private }
         -> unsigned tx
Agent -> signs, sendRawTransaction to ephemeral RPC

Agent -> GET /api/data
         + X-Payment-ID: <ulid>
         + X-Payment-Token: <token>

Server -> verifies HMAC on token (catches tampering)
Server -> checks memo-to-sig map (populated by logsSubscribe)
          - if verified: confirm amount matches payload, check tx not in recent-used set
          - else: return 402 (client retries)
Server -> 200 OK + data
```

### Key protocol differences from x402

- `X-Payment-Network: solana-per` signals PER support
- `X-Payment-ID` is a ULID, `X-Payment-Token` is an HMAC-signed payload carrying all server state
- Server runs no database. All "memory" rides on the signed token
- Verification is a memo lookup against the ER logsSubscribe stream
- Client retries with same payment_id until verified or expired (5-min TTL)

### Headers summary

| Header | On 402 | On retry | Purpose |
|--------|--------|----------|---------|
| X-Payment-Amount | ✓ | | amount in decimal USDC |
| X-Payment-Currency | ✓ | | `USDC` for now, extensible |
| X-Payment-Network | ✓ | | `solana-per` |
| X-Payment-Address | ✓ | | server's PER ATA |
| X-Payment-ID | ✓ | ✓ | ULID, matches memo on PER transfer |
| X-Payment-Token | ✓ | ✓ | HMAC-signed payload |

## Architecture Diagram

```
+-----------------------------+     +-----------------------------+
|  Agent (Client Side)        |     |  API Server (Provider Side) |
|                             |     |                             |
|  +----------------------+   |     |  +----------------------+   |
|  | @px402/client        |   |     |  | @px402/hono          |   |
|  |                      |   |     |  | (or express/next)    |   |
|  | - Detects 402        |   |     |  |                      |   |
|  | - Reads PER address  |   |     |  | - Issues 402 with    |   |
|  |   + payment_id       |   |     |  |   HMAC token         |   |
|  | - POST /spl/transfer |   |     |  | - On retry: verify   |   |
|  |   with memo=<ulid>   |   |     |  |   HMAC + lookup      |   |
|  | - Signs, submits to  |   |     |  |   memo -> tx         |   |
|  |   ephemeral RPC      |   |     |  | - Rate limits        |   |
|  | - Retries with token |   |     |  +----------+-----------+   |
|  | - Returns API data   |   |     |             |               |
|  +----------+-----------+   |     |             v               |
|             |               |     |  +----------+-----------+   |
+-------------|---------------+     |  | logsSubscribe WS     |   |
              |                     |  | -> memo-to-sig map   |   |
              v                     |  | (in-memory, 5min TTL)|   |
    +---------+-----------------+   |  +----------------------+   |
    |  MagicBlock PER (TEE)    <----+                             |
    |                          |                                  |
    |  Agent ATA --[memo]----> Server ATA                         |
    |                                                             |
    |  - Transfers invisible on mainnet                           |
    |  - Memo is plaintext ULID (no PII, not linkable             |
    |    without server's HMAC secret)                            |
    +-------------------------------------------------------------+
```

## Package Layout (pnpm workspaces)

Repo location: `~/px402/` (outside the Brain vault, next to other project repos).

```
~/px402/
├── package.json              # workspace root
├── pnpm-workspace.yaml
├── tsconfig.json
├── packages/
│   ├── core/                 # @px402/core
│   │   ├── src/
│   │   │   ├── token.ts      # HMAC sign/verify, rotation buffer
│   │   │   ├── verify.ts     # memo lookup, replay prevention
│   │   │   ├── rate-limit.ts # IP + per-wallet buckets
│   │   │   ├── subscribe.ts  # logsSubscribe + signatureSubscribe fallback
│   │   │   ├── types.ts      # shared types (PaymentConfig, etc.)
│   │   │   └── index.ts
│   │   └── test/
│   ├── hono/                 # @px402/hono
│   │   └── src/middleware.ts
│   ├── express/              # @px402/express
│   │   └── src/middleware.ts
│   ├── next/                 # @px402/next
│   │   └── src/handler.ts    # App Router wrapper
│   ├── client/               # @px402/client
│   │   ├── src/fetch.ts      # fetch wrapper with 402 detection
│   │   ├── src/deposit.ts
│   │   ├── src/balance.ts
│   │   ├── src/withdraw.ts
│   │   └── src/index.ts
│   ├── cli/                  # @px402/cli
│   │   └── src/bin.ts        # `npx px402 deposit/balance/withdraw/history`
│   └── mcp/                  # @px402/mcp
│       └── src/server.ts     # MCP tools: fetch/balance/deposit/withdraw/history
├── apps/
│   ├── demo-apis/            # 3 demo APIs behind @px402/hono
│   │   └── src/
│   │       ├── sentiment.ts
│   │       ├── whales.ts
│   │       └── risk.ts
│   └── dashboard/            # Next.js creator/agent dashboard
└── examples/
    └── agent/                # Standalone demo agent calling all 3 APIs
```

## Demo Setup

Three demo APIs behind @px402/hono:

| API | Endpoint | Price | What it does |
|-----|----------|-------|--------------|
| Token Sentiment | `/api/sentiment?token=SOL` | 0.01 USDC | bullish/bearish + confidence |
| Whale Tracker | `/api/whales?min=100000` | 0.02 USDC | recent large transfers |
| Risk Score | `/api/risk?address=...` | 0.03 USDC | wallet risk assessment |

Demo agent:

1. Deposits 1 USDC into PER (one-time via `@px402/cli`)
2. Calls all 3 APIs via `@px402/client`
3. Combines results into a trading signal
4. Dashboard shows: 3 calls, 0.06 USDC spent, Solana explorer shows only the deposit

## Implementation Phases

Solo builder, ~3 weeks. Phase 3 onward splits into parallel lanes dispatchable to CC workers.

### Phase 1: Protocol Core (Days 1-4)

- `@px402/core`: HMAC token sign/verify, memo verification, rate limiter, logsSubscribe subscriber
- `@px402/hono`: middleware wrapping core
- One endpoint behind middleware + one client script, full round trip on devnet
- Unit tests for core (100% coverage target) + one E2E against live devnet
- Ship Assignment #2 from original plan here

### Phase 2: Client SDK + first demo API (Days 5-7)

- `@px402/client`: fetch wrapper, deposit, balance, withdraw
- `apps/demo-apis/sentiment`: first API behind middleware
- Integration test: client → sentiment API → private payment → 200
- Deploy demo-apis to Railway

### Phase 3: Parallel lanes (Days 8-14)

**Lane A** (can start once Phase 2 ships):
- `apps/demo-apis/whales` and `apps/demo-apis/risk`
- Second + third demo APIs, same middleware

**Lane B:**
- `@px402/cli`: deposit/balance/withdraw/history commands
- `examples/agent`: standalone agent calling all 3 APIs

**Lane C:**
- `@px402/express` and `@px402/next` adapters
- Integration tests per adapter

### Phase 4: MCP + Dashboard + polish (Days 15-18)

- `@px402/mcp`: 5 MCP tools wrapping client SDK
- `apps/dashboard`: Next.js payment history + "privacy proof" split view
- Publish all `@px402/*` packages to npm
- README with integration guide

### Phase 5: Demo + submission (Days 19-21)

- 3-min demo video (Problem → Solution → Demo)
- Colosseum submission
- Submission materials: repo, deployed URLs, video link

## Test Plan

```
@px402/core
├── createPaymentToken()
│   ├── [UNIT] happy: valid config → {paymentId, token}
│   ├── [UNIT] deterministic HMAC given fixed payload
│   └── [UNIT] rejects invalid amount/path
├── verifyPaymentToken()
│   ├── [UNIT] valid current-key token → payload
│   ├── [UNIT] tampered payload → InvalidTokenError
│   ├── [UNIT] expired token → ExpiredError
│   ├── [UNIT] previous-key token during rotation window → payload
│   └── [UNIT] token signed by third key → InvalidTokenError
├── verifyPaymentOnPer()
│   ├── [UNIT] memo match + amount match → verified (mock RPC)
│   ├── [UNIT] memo not yet indexed → pending
│   ├── [UNIT] memo match but amount mismatch → InvalidPayment
│   ├── [UNIT] tx signature already used → ReplayError
│   └── [UNIT] RPC error → RetryableError
└── rate limiter
    ├── [UNIT] IP limit: N+1 requests from same IP → 429
    ├── [UNIT] per-wallet limit: bucket separate from IP
    └── [UNIT] limits reset after window

@px402/hono, @px402/express, @px402/next  (per adapter)
├── [INT→E2E] mount middleware, hit /api/data without payment → 402 + headers
├── [INT→E2E] valid token + memo → 200 + content
├── [INT→E2E] streaming response path (Next only) → 200
└── [INT→E2E] error handler compat

@px402/client
├── client.fetch()
│   ├── [E2E] 402 → pay → retry 200 → returns data
│   ├── [E2E] insufficient PER balance → InsufficientBalanceError
│   ├── [E2E] second retry returns 402 → exponential backoff → success
│   ├── [E2E] payment_id expires mid-retry → re-request 402 → pay → succeed
│   └── [E2E] network error on transfer → retry → success
├── client.deposit() → balance updates on PER
├── client.balance() → matches API response
└── client.withdraw() → funds back on mainnet

Concurrent flows
├── [E2E] Two agents paying to same server simultaneously → both verify
│   (CRITICAL regression — memo verification unlocks this, must stay green)
└── [E2E] Same agent paying N endpoints rapidly → memo-disambiguated

CLI + MCP + Dashboard
├── [SMOKE] px402 deposit 1.0 → balance == 1.0
├── [SMOKE] px402 balance → prints balance
├── [SMOKE] MCP tool discovery lists all 5 tools
└── [SMOKE] dashboard renders payment history from log
```

**CRITICAL regression test:** two agents paying same server concurrently. The original plan was broken on this case. Memo verification fixes it. A regression test MUST prove it stays fixed.

**Infrastructure:** mock MagicBlock API server for fast unit tests (no devnet in CI). One devnet integration run on demand.

## Demo Video Flow (3 min)

1. **(30s) Problem:** "x402 lets agents pay for APIs on Solana. Every payment is public. I can watch your agent's wallet: you call a sentiment API 50 times a day, a whale tracker 10 times, a risk scorer 5 times. Now I know your strategy."

2. **(30s) Solution:** "px402 is x402 with private payments. Same flow. 402, pay, get data. The payment goes through MagicBlock's Private Ephemeral Rollup. No mainnet trace."

3. **(20s) Server setup:** Adding `@px402/hono` middleware to a server. Three lines of code. "API providers opt in by adding the middleware."

4. **(40s) Agent demo:** Agent deposits 1 USDC into PER. Agent calls all 3 APIs. Show each 402, payment, response. Solana explorer: only the initial deposit. Dashboard: full payment history visible to the creator.

5. **(30s) Privacy proof:** Split screen. Left: Solana explorer, agent's wallet, zero outgoing transactions after the deposit. Right: px402 dashboard, 3 API calls, 0.06 USDC spent. "Blockchain sees one deposit. Dashboard sees everything."

6. **(10s) Close:** "px402. Private API payments for agents. Built on MagicBlock PER."

## Error Handling

| Scenario | Response | Resolution |
|----------|----------|------------|
| Insufficient PER balance | 402 + balance hint | Agent tops up via `client.deposit()` |
| PER transfer succeeds but memo not yet in logsSubscribe stream | 402 again | Client retries at 500ms, 1s, 2s |
| Payment_id expired (>5 min) | 402 + "expired" | Client requests fresh payment_id, pays again |
| Server logsSubscribe WS drops | server reconnects, falls back to polling during gap | Client retries succeed once WS back |
| HMAC signature invalid | 401 Unauthorized | Client did not receive token from this server |
| Agent claims payment but didn't pay | 402 persists | Memo lookup never matches. No free rides. |
| Multiple agents pay simultaneously | All verified independently | Memo disambiguates — no ordering dependency |
| Rate limit hit | 429 + Retry-After | Client backs off, retries |

## NOT In Scope

- x402 fallback for non-PER clients (deferred to stretch)
- Rate limiting behind WAF or CDN (core middleware only)
- Non-USDC tokens (USDC devnet mint only)
- Payment splits / revenue share (stretch in original plan, out now)
- Multi-chain (Solana PER only)
- Next.js Pages Router (App Router only)
- Encrypted memo content (memo is plaintext ULID; not PII, not linkable without server HMAC secret)
- Public Solana tx lookup (memo verification does not touch mainnet)

## What Already Exists (don't rebuild)

- MagicBlock Private Payments REST API — deposit/transfer/withdraw endpoints
- MagicBlock Ephemeral Rollup RPC — Solana-compatible, returns memo in getSignaturesForAddress
- `@magicblock-labs/ephemeral-rollups-sdk` — delegate/undelegate/initVault/withdraw instructions
- Solana Memo Program — via API's `memo` field
- Coinbase x402 middleware — reference implementation to adapt header conventions from
- ULID library (`ulidx`) — don't write one
- Hono / Express / Next middleware patterns — standard plumbing
- `@modelcontextprotocol/sdk` — off-the-shelf MCP server
- `@solana/web3.js` `sendRawTransaction` to ephemeral connection — submission path confirmed via MagicBlock demo repo

## Open Questions

All three blockers from the original plan are now resolved. Remaining unknowns surface during implementation, not before:

1. Production `tee.magicblock.app` endpoint auth requirements. Devnet ER allows unauthenticated read. Production may require server wallet auth. Test early in Phase 1.
2. PER balance query auth. `/v1/spl/private-balance` returned "authorization is required" during devnet probe. Confirm server wallet can sign the auth challenge.
3. Whether `logsSubscribe("all")` on ER can be filtered to a single ATA at subscribe-time vs filtering server-side. Performance concern only, not correctness.

## Success Criteria

- [ ] Protocol works end-to-end: agent pays API via PER, gets content, no mainnet trace
- [ ] Middleware installable in <5 lines across Hono, Express, Next.js
- [ ] Client SDK handles 402 detection + PER payment automatically
- [ ] 3 demo APIs running behind px402
- [ ] MCP tools work with Claude
- [ ] Dashboard shows private payment history
- [ ] "Privacy proof" split screen: Solana explorer vs px402 dashboard
- [ ] Demo video in Problem → Solution → Demo format
- [ ] Live deployment + public GitHub repo
- [ ] All `@px402/*` packages published to npm
- [ ] CRITICAL regression test: two concurrent agents both verify

## Distribution Plan

- GitHub repo (public, required)
- npm org `@px402` with packages: `core`, `hono`, `express`, `next`, `client`, `cli`, `mcp`
- Live deployment: demo-apis on Railway, dashboard on Vercel
- Submit to: Colosseum Frontier + MagicBlock Privacy Track

## Devnet Bootstrap State (2026-04-21)

| Artifact | Value |
|----------|-------|
| Test USDC mint | `5CmxDcDtDiqwxy9TDVyo1Xjr4AFwQzrH7vKr8cXfkEse` |
| Name / Symbol | USD Coin / USDC (mimics Circle USDC for demo authenticity) |
| Decimals | 6 |
| Mint keypair | `~/.config/solana/px402-usdc-mint.json` |
| Mint authority | Allen's base wallet `3wBhCBpCudbtfdaGdBRWhjsRq9B2yAkAgKadjJkVdAiA` |
| Supply minted | 1,000,000 USDC |
| Allen's ATA | `3PkQ4JM6WWWEpxoaQtFczYgn47ZkMmdFWySSBfGVVh6v` |
| Metadata URI | https://raw.githubusercontent.com/Allen-Saji/px402-assets/main/metadata.json |
| Asset repo | https://github.com/Allen-Saji/px402-assets |
| PER initialized | true |
| PER validator | `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57` |
| PER transfer queue | `4dA398Eh9P61oGLqebRTYEQD7n4HvwxButoU5NM9C2gu` |

Bootstrap scripts at [[Projects/px402/bootstrap/README]].

Devnet init-mint RTT measured: 460ms submit + 961ms confirm = 1421ms total on base chain.

## Dependencies

- MagicBlock Private Payments API (devnet confirmed, production on `tee.magicblock.app`)
- `@magicblock-labs/ephemeral-rollups-sdk`
- `@solana/web3.js`
- `@solana/spl-token`
- `hono`, `express`, `next`
- `@modelcontextprotocol/sdk`
- `ulidx`
- `ws` (WebSocket client for logsSubscribe)
- `zod` (config validation)

## Engineering Review Trail (2026-04-21)

This section captures the review session for future reference. Each finding below changed the design.

### Step 0: Scope Challenge

All 5 deliverables held as planned (server, client, MCP, 3 APIs, dashboard). Dashboard reduction considered but rejected.

### Section 1: Architecture

**Issue 1 resolved: balance-delta verification was broken.** Original plan's cumulative balance check rejected any single payment when another was still pending. Memo test unlocked trivial memo-based verification.

**Issue 2 resolved: memo test ran on live devnet.** 
- `POST /v1/spl/transfer` accepts `memo` field
- Ephemeral RPC returns memo in `getSignaturesForAddress` response
- magicblock-core 0.8.8, full Solana-RPC compatibility
- Cost of memo: +61 bytes, +~500 CUs (~10%), fees negligible inside PER

**Issue 3 resolved: DoS on payment_id issuance.** IP + per-wallet rate limit in core middleware.

**Issue 4 resolved: server state.** Stateless server via HMAC-signed payment tokens. Adopters do not need Postgres.

**Issue 5 resolved: framework coupling.** Core + Hono + Express + Next.js App Router adapters.

**Issue 6 resolved: agent deposit UX.** Three surfaces: SDK method, CLI, MCP tool.

### Section 2: Code Quality / Structure

- Monorepo: pnpm workspaces, packages per concern
- Npm scope: `@px402`
- HMAC secret: env var + auto-gen in dev + two-key rotation buffer

### Section 3: Test Review

30+ test cases mapped across 8 packages. CRITICAL regression: two concurrent agents both verify.

### Section 4: Performance

- logsSubscribe WebSocket chosen over polling for <50ms verification narrative in demo
- Rate limiter memory bounded via LRU eviction
- Client retry backoff: 500ms / 1s / 2s / fresh (based on measured confirmation latency)

### Latency Tests (2026-04-21)

Funded devnet wallet `3wBhCBpCudbtfdaGdBRWhjsRq9B2yAkAgKadjJkVdAiA`.

| Test | Result |
|------|--------|
| `getLatestBlockhash` RTT, ER direct | min 100ms, p50 205ms, p90 645ms |
| `sendRawTransaction` on base chain | 281-302ms (leader accepts) |
| `confirmTransaction('confirmed')` on base | 1432-1536ms |
| ER sendRawTx estimate | ~300ms submit + ~100ms confirm = ~400ms (scaled by block-time ratio) |
| Commitment semantics on ER | **inverted vs mainnet** — `finalized` > `processed` in slot number |
| `signatureSubscribe` on ER | supported, 101ms ACK |

### Outside voice

Skipped. Findings had high confidence, decisions were concrete, Allen had scope to build.

## References

- [[px402 Design]] (this file)
- Original draft: archived, superseded by this doc on 2026-04-21
- MagicBlock API docs: https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/api-reference/per/introduction
- Transfer endpoint: https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/api-reference/per/transfer
- Private balance: https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/api-reference/per/private-balance
- MagicBlock private-payments-demo: https://github.com/magicblock-labs/private-payments-demo
- Colosseum Codex write-up: https://blog.colosseum.com/umbra-sdk-magicblock-private-payments-x402/
- x402 reference (Coinbase): https://github.com/coinbase/x402
- Colosseum Frontier hackathon: https://www.colosseum.org/
