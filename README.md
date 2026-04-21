# px402

Private x402 payments for agent APIs on Solana, via MagicBlock Private Ephemeral Rollups.

Same 402 flow as [x402](https://github.com/coinbase/x402). Payments settle on PER instead of mainnet. Consumption patterns stay private.

**Status:** pre-alpha, in active development for Colosseum Frontier (MagicBlock Privacy Track, deadline 2026-05-12).

## Packages

| Package | Purpose |
|---|---|
| `@px402/core` | HMAC tokens, memo verification, rate limiting, logsSubscribe |
| `@px402/hono` | Hono middleware |
| `@px402/express` | Express middleware (planned) |
| `@px402/next` | Next.js App Router handler (planned) |
| `@px402/client` | Fetch wrapper + deposit/balance/withdraw (planned) |
| `@px402/cli` | `npx px402 …` (planned) |
| `@px402/mcp` | MCP server (planned) |

## Design

See [design.md](./design.md) (mirror of the locked design doc in Brain vault).

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
```

## ER commitment gotcha

On MagicBlock ER, `processed ≤ confirmed ≤ finalized` in slot number — opposite of mainnet.
Always use `commitment: 'finalized'` on reads.

## License

MIT
