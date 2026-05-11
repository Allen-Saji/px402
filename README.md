# px402

Private-payment extension of the [x402](https://github.com/coinbase/x402) protocol. Agents pay for APIs with USDC on Solana, routed through MagicBlock's Private Ephemeral Rollups so the recipient (and therefore which API the agent consumed) stays hidden.

**Status:** pre-alpha. End-to-end verified on devnet: a `fetch()` call against a px402-gated endpoint returns a 200 in roughly four seconds, including the base-chain payment, TEE decryption, queue crank, and server-side verify.

## How it works

![px402 architecture](./assets/architecture.png)

**What's public on Solana:** the sender, the mint, the amount. **What's hidden:** the recipient. An outside observer cannot tell which API (or which service provider) the agent is paying. A settlement tx eventually lands the funds in the recipient's ATA on base chain, but the link from the agent tx to that settlement is broken by the TEE.

## Packages

| Package | Purpose | Status |
|---|---|---|
| `@px402/core` | HMAC tokens, crank log parsing, polling subscriber, PDA helpers, framework-agnostic `decide()` | shipped |
| `@px402/hono` | Hono middleware | shipped |
| `@px402/express` | Express middleware | shipped |
| `@px402/next` | Next.js App Router wrapper | shipped |
| `@px402/client` | `fetch` wrapper + `deposit` / `withdraw` / `balance` / `privateBalance` / `transfer` | shipped |
| `@px402/mcp` | MCP server (`px402_fetch`, `px402_balance`) | shipped |

Adopters install the adapter for their framework and the client separately.

## Protocol

### 402 response headers

| Header | Value |
|---|---|
| `X-Payment-Amount` | Micro-USDC as decimal string (e.g. `10000` = 0.01 USDC) |
| `X-Payment-Currency` | `USDC` |
| `X-Payment-Network` | `solana-per` |
| `X-Payment-Address` | Server **wallet** pubkey (not ATA). The API derives the correct ATA. |
| `X-Payment-Id` | Decimal u63. Echoed verbatim as `clientRefId` on the transfer. |
| `X-Payment-Token` | `v1.<base64url(payload)>.<base64url(hmac)>` — server-signed state so the server stays stateless across the pay-then-retry window. |

### Retry request

After paying, the client retries the original request with `X-Payment-Id` + `X-Payment-Token`. Possible responses:

| Status | Meaning |
|---|---|
| `200` | Verified. Response includes `X-Payment-Signature` (the settlement tx). |
| `402 payment_pending` | Transfer seen on-chain but the crank has not yet popped the queue. Client retries. |
| `402 reason: "expired"` | Token TTL elapsed. Response carries a fresh `X-Payment-Id` + token; client pays again. |
| `401` | Token invalid (tampered, mismatched id/path/amount/destination). |
| `409 replay` | Same tx signature already consumed. |
| `429` | Rate limit exceeded (IP or per-wallet). |

### Payment transfer

The client posts this body to MagicBlock's `/v1/spl/transfer`:

```json
{
  "from":         "<agent wallet>",
  "to":           "<server wallet>",
  "amount":       10000,
  "mint":         "<USDC mint>",
  "cluster":      "devnet",
  "visibility":   "private",
  "fromBalance":  "base",
  "toBalance":    "base",
  "clientRefId":  "<paymentId from X-Payment-Id>"
}
```

The API returns an unsigned transaction. The client signs with the agent keypair and submits to the base RPC. From there the TEE takes over.

## Non-obvious behaviors, baked into the code

These are implementation-reality findings the original design doc does not cover. They're encoded in the shipped packages, but worth calling out:

1. **`visibility: private` on an `ephemeral→ephemeral` transfer is a no-op.** MagicBlock's SDK emits a bare SPL Transfer for that route against an undelegated PDA, so the tx fails on ER. The only private route that actually settles is `fromBalance: base, toBalance: base`. Client defaults reflect this.

2. **`X-Payment-Address` must be a wallet pubkey, not an ATA.** The REST API treats `to` as a wallet and derives the ATA itself. Passing an ATA causes it to derive an ATA-of-an-ATA, which doesn't exist on chain and the tx fails with `InvalidWritableAccount`.

3. **Memos don't survive the crank.** The memo instruction rides on the agent's base-chain tx only. The ER-side `ProcessTransferQueueTick` log that signals settlement carries `clientRefId` instead. px402 uses `clientRefId` as the payment identifier end-to-end.

4. **MagicBlock log lines truncate at ~213 characters.** The pop log cuts off the trailing `amount:` field when `clientRefId` is long. The subscriber indexes amount from the earlier `DepositAndQueueTransfer` log and cross-references by `clientRefId`.

5. **`logsSubscribe` on MagicBlock ER accepts subscriptions but never delivers notifications.** The subscriber polls `getSignaturesForAddress` with an `until` watermark and fetches transactions in parallel batches of 16.

6. **The crank won't run unless someone kicks it.** Servers must call `GET /v1/spl/is-mint-initialized` at startup and on an interval. That endpoint internally invokes `ensureTransferQueueCrankRunning`, which registers the recurring 500 ms `ProcessTransferQueueTick` on MagicBlock's `Crank11…` program.

7. **ER commitment ordering is inverted.** `processed ≤ confirmed ≤ finalized` in slot number. Always read with `finalized`; `processed` is an older view.

8. **Insert and pop logs land in separate transactions on the queue PDA.** A naive `Promise.all` over a chunk of fetched signatures races: pop's `queuedAmounts.get` can resolve before insert's `queuedAmounts.set` completes, even though insert is chronologically older. The subscriber works in three deterministic phases per chunk: parallel fetch (network IO concurrent), local parse (no state mutation), then **sequential sorted apply** keyed on `(slot ASC, txOrder ASC, kind: insert before pop)`. Insert always lands in the index before the matching pop reads it.

9. **Pops without a matching insert get buffered, not dropped.** When the subscriber starts mid-flight, an insert may have happened before the watermark seed. The subscriber buffers such orphaned pops in an in-memory map (capped at 1000 entries, 10-min TTL) and resolves them when the matching insert arrives in a later poll. If the insert never appears forward, a directed **backwards `getSignaturesForAddress({ before })`** scan walks 50 sigs back, then 200, looking for the missing insert. Backwards-scans are rate-limited to 5/minute to bound RPC load.

10. **Watermark only advances after the chunk's apply phase succeeds.** Earlier code advanced the watermark immediately after the RPC call, which meant any failure during processing silently lost the affected sigs. The subscriber now keeps the watermark put on chunk failure; the next poll re-fetches, and the per-sig `processedSigs` set (populated only after a definitive `getTransaction` result) prevents double-processing of the ones that did succeed.

11. **Stale blockhashes show up under load.** MagicBlock's REST API returns an unsigned transaction with a recent blockhash. Under devnet congestion the blockhash can expire before the client signs and submits. `Px402Client.transfer` retries up to 3× with fresh `postBuild` calls on `block height exceeded` / `Connect Timeout` / `fetch failed` / similar transient errors before surfacing them.

## Demo

The `apps/demo-apis` server exposes three priced routes backed by deterministic mock data:

| Route | Price | Purpose |
|---|---:|---|
| `/api/sentiment?token=SOL` | 0.01 USDC | bullish / bearish / neutral + confidence |
| `/api/whales?min=100000` | 0.02 USDC | recent large transfers |
| `/api/risk?address=…` | 0.03 USDC | wallet risk score + signal flags |

Run the demo locally:

```bash
pnpm install
cp apps/demo-apis/.env.example apps/demo-apis/.env
# edit .env to set PX402_PAYMENT_ADDRESS to your server wallet
pnpm --filter px402-demo-apis start &
pnpm --filter px402-example-agent start
```

The agent script loads a Solana keypair from `~/.config/solana/id.json` by default and calls `/api/sentiment` through `@px402/client`. Each call makes one base-chain payment; no pre-deposit or PER top-up.

## Development

```bash
pnpm install
pnpm build        # compile dist/ for each package (required before running integration tests)
pnpm test         # 73 vitest cases across all packages (no devnet, ~1s)
pnpm typecheck

# Real-devnet integration suite (10 scenarios, requires funded keypair at ~/.config/solana/id.json)
pnpm fund -- --count 30          # one-time wallet pool provisioning
pnpm test:devnet                 # full suite (~12 min total when run sequentially)

# Stress harness — configurable burst load
pnpm stress -- --agents 30 --rate 6 --duration 5
```

Empirical numbers from a clean devnet run:
- Single payment end-to-end: **~4 seconds** (no retries)
- 30-payment burst over 5 seconds, distinct wallets: **96.7% success, p50 8.3s, p90 15.9s, avg 1.34 retries**
- Subscriber-lag scenario (insert older than watermark): orphan pop is buffered, backwards-scanned, and resolved within ~5 seconds

## License

MIT
