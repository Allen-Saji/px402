# px402 integration tests

Real-devnet end-to-end tests for the px402 protocol. No mocks. Each scenario
boots a fresh `apps/demo-apis` subprocess against MagicBlock's devnet endpoints
and exercises the full `agent → 402 → MagicBlock private transfer → settlement
crank → server verify → 200` round trip.

## Prerequisites

- Funder wallet at `~/.config/solana/id.json` holding:
  - **≥0.5 SOL on devnet** (covers `solana airdrop` retries + airdrop fallback transfers)
  - **≥30 USDC of the px402 test mint (`5CmxDcDtDiqwxy9TDVyo1Xjr4AFwQzrH7vKr8cXfkEse`)** to fund 30 stress wallets at 1 USDC each
- Server keypair at `~/.config/solana/px402-server.json` (auto-generated on first run)
- Network access to `payments.magicblock.app`, `rpc.magicblock.app`, `devnet.magicblock.app`, `api.devnet.solana.com`

## Running

```bash
# Provision the wallet pool once (cached at .tmp/funded-pool.json)
pnpm --filter px402-integration-tests fund -- --count 30

# Run the full suite (gated on PX402_DEVNET=1 — default `pnpm test` skips them)
pnpm --filter px402-integration-tests test:devnet

# Single scenario
PX402_DEVNET=1 pnpm --filter px402-integration-tests vitest run 04-concurrent-distinct-wallets.test.ts

# Force re-fund (drains funder wallet by ~30 USDC + ~1.5 SOL)
pnpm --filter px402-integration-tests fund -- --refund --count 30
```

## What each scenario proves

| # | File | What it asserts |
|---|---|---|
| 01 | `01-single-payment.test.ts` | Smoke: one payment → 200 within ~10 min (devnet crank-bound; see [KNOWN_LIMITATIONS.md](../../KNOWN_LIMITATIONS.md)) |
| 02 | `02-sequential-payments.test.ts` | 5 sequential calls, all succeed, no state pollution |
| 03 | `03-concurrent-same-wallet.test.ts` | 5 parallel from one wallet — exercises same-batch settlement ordering |
| 04 | `04-concurrent-distinct-wallets.test.ts` | 10 parallel from 10 wallets — original race condition at scale |
| 05 | `05-burst-stress.test.ts` | 30 payments staggered over 5s; ≥28 succeed; reports p50/p90/p99 |
| 06 | `06-subscriber-lag.test.ts` | Pay BEFORE subscriber starts; watermark backfill recovers the missed tick. Architecturally obsolete in the single-tx model — kept until deletion lands. |
| 07 | `07-token-expiry.test.ts` | Token TTL of 5s expires mid-retry; client gets fresh 402; pays again; succeeds |
| 08 | `08-amount-mismatch.test.ts` | Agent pays half the quoted amount; server returns 402 amount_mismatch |
| 09 | `09-tampered-token.test.ts` | Flipped HMAC payload byte → 401 invalid_token |
| 10 | `10-replay-attack.test.ts` | Resubmit same paymentId after success → 409 replay |

## Output

- Per-test stdout shows `[##] status=200 latency=Xms retries=N`
- On failure, last 2-5K of server stdout is dumped for forensics
- Per-payment latency post-2026-05-13 is bounded by MagicBlock's devnet crank cadence (~4 min). Old pre-protocol-change burst numbers (p50 ≈ 6-10s) no longer apply; the suite times reflect the new cadence.

## Known limitations

- **Crash recovery not covered.** If the demo-apis subprocess restarts mid-payment (because of a code bug), in-flight verifications are lost. This is a documented future-work item — needs persisted watermark + replay set.
- **Devnet RPC flakiness.** `solana airdrop` is rate-limited. The funder fallback (direct SOL transfer) handles this. Persistent RPC outages will fail the suite — re-run.
- **Cost.** Each full run consumes ~1.5 SOL in fees + payment amounts. Wallets are reused across runs via `.tmp/funded-pool.json` cache.

## Cleanup

```bash
# Drop the funded-pool cache (next run re-provisions)
rm tests/integration/.tmp/funded-pool.json

# Reclaim USDC (manual — transfer from each pool wallet back to funder via spl-token)
# Or just leave the pool dust; 30 wallets × 1 USDC is negligible on devnet.
```
