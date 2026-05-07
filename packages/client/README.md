# @px402/client

`fetch()` wrapper that automatically pays on 402, plus PER deposit/withdraw/balance/transfer helpers. The client side of [px402](https://github.com/Allen-Saji/px402).

## Install

```sh
pnpm add @px402/client @solana/web3.js
```

## Quick start

```ts
import { Px402Client } from "@px402/client";
import { Keypair } from "@solana/web3.js";

const wallet = Keypair.fromSecretKey(/* your agent's secret key */);

const client = new Px402Client({
  wallet,
  mint: "5CmxDcDtDiqwxy9TDVyo1Xjr4AFwQzrH7vKr8cXfkEse", // devnet test USDC
  cluster: "devnet",
});

// One-line paid fetch. Handles 402 -> pay -> retry transparently.
const res = await client.fetch("https://demo.example.com/api/sentiment?token=SOL");
const data = await res.json();
console.log(res.headers.get("X-Payment-Signature"), data);
```

## Funding the agent

Before the first paid call, fund the agent's PER (private ephemeral rollup) balance:

```ts
await client.deposit(1_000_000n); // 1 USDC in micro-USDC
```

Spent down by 402 calls. Pull funds back to base chain when done:

```ts
await client.withdraw(500_000n);
```

## Reading balances

```ts
const base = await client.balance();          // base-chain USDC
const per  = await client.privateBalance();   // PER USDC (what gets spent)
```

## Direct transfer

For non-HTTP flows or pre-paying:

```ts
await client.transfer({
  destination: "6dRPtBVYiJ6iM7eQqDzCQpBDACBzYoZjGqostfZqrgGU",
  amount: 10_000n,
  clientRefId: "1234567890",
  visibility: "private",
});
```

## Hooks for observability

```ts
await client.fetch(url, init, {
  onBeforePay: ({ amount, destination }) => log.info("paying", { amount, destination }),
  onAfterPay:  ({ signature })          => log.info("paid", { signature }),
  onRetry:     ({ attempt, delayMs })   => log.info("retry", { attempt, delayMs }),
});
```

## Errors

| Error | When |
|---|---|
| `PaymentRequiredError` | Server returned 402 without payment headers |
| `InsufficientBalanceError` | PER balance < required amount |
| `MaxRetriesExceededError` | Retry budget exhausted before crank verified |

All extend `Px402ClientError` with a `code` string.

## Defaults

| Field | Default |
|---|---|
| `apiUrl` | `https://payments.magicblock.app` |
| `baseRpcUrl` | `https://rpc.magicblock.app/devnet` |
| `ephemeralRpcUrl` | `https://devnet.magicblock.app` |
| `cluster` | `"devnet"` |
| `visibility` | `"private"` |
| `fromBalance` / `toBalance` | `"base"` (only fully-working route on MagicBlock today) |

## License

MIT
