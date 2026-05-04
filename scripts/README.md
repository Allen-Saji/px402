# px402 scripts

Operational scripts that aren't shipping with the SDK packages.

## stress-burst

Load-test the px402 protocol against MagicBlock's devnet. Spawns a fresh
demo-apis server, dispatches N concurrent agent calls at a configured arrival
rate, and emits a CSV stream + JSON summary.

```bash
# Default: 30 agents, 6/sec, ~5s dispatch window
pnpm --filter px402-scripts stress:burst

# Heavier: 100 agents, 20/sec, 5s dispatch window
pnpm --filter px402-scripts stress:burst -- --agents 100 --rate 20 --duration 5

# Force re-fund the wallet pool (drains funder by ~N USDC + ~N×0.05 SOL)
pnpm --filter px402-scripts stress:burst -- --agents 30 --refund

# Capture into a file for later analysis
pnpm --filter px402-scripts stress:burst -- --agents 50 > stress-50.csv

# Keep the server running after the run for follow-up debugging
pnpm --filter px402-scripts stress:burst -- --keep-server
```

CSV columns: `agent_idx,wallet,dispatched_at_ms,completed_at_ms,latency_ms,status,retries,payment_id,signature,error`

JSON summary written to `tests/integration/.tmp/stress-summary.json` by default.
Override with `--summary path/to/file.json`.

## Funding the wallet pool

```bash
pnpm --filter px402-integration-tests fund -- --count 30
```

Cached at `tests/integration/.tmp/funded-pool.json`. Reused across runs unless
`--refund` is passed.
