# Contributing to px402

Thanks for your interest. px402 is pre-alpha — bug reports, design feedback, and small PRs are all welcome.

## Before you start

For anything beyond a typo fix or one-line bug, **open an issue first** so we can agree on shape before you spend time on a PR. The protocol surface is small; ad-hoc changes can ripple across six packages.

## Dev setup

```bash
git clone https://github.com/Allen-Saji/px402.git
cd px402
pnpm install
pnpm build        # compile dist/ for each package
pnpm test         # vitest across all packages (no devnet, ~1s)
pnpm typecheck
```

Node 22+ and pnpm 10+ are required (pinned via `.nvmrc` and `packageManager`).

## Tests

- **Unit tests** (`pnpm test`) — vitest, fully mocked, no network. CI runs these on every PR.
- **Integration tests** (`pnpm test:devnet`) — real MagicBlock devnet, ten scenarios, gated on `PX402_DEVNET=1`. Needs a funder wallet at `~/.config/solana/id.json` with ≥0.5 SOL + ≥30 USDC of the test mint. See [`tests/integration/README.md`](./tests/integration/README.md).
- **Stress harness** (`pnpm stress`) — burst-load probe; configurable agents/rate/duration.

If your change touches `@px402/core` or the protocol surface, run the relevant integration scenarios locally before opening the PR.

## Commit style

[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`. Breaking changes use `feat!:` or `fix!:` and a `BREAKING CHANGE:` footer.

Examples from the history:

```
feat(core)!: rewrite subscriber for base-chain ExecuteReadyQueuedTransfer flow
fix(client): retry stale blockhash via fresh postBuild
docs: realign repo docs to base-chain flow
```

Keep messages plain ASCII. No emojis.

## PR checklist

- [ ] Tests added or updated
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm build` all green
- [ ] CHANGELOG `[Unreleased]` updated if this is user-facing
- [ ] No personal paths, secrets, or wallet keys in the diff
- [ ] Conventional Commit title

## What's in scope for 0.1

See the README's "Limitations & roadmap" section. The short version: single-tenant subscriber, single-RPC pool, devnet-first. Anything broader is welcome as an issue, not a PR.

## Licensing

px402 is Apache-2.0 licensed. By submitting a contribution you agree it will be released under the same license (Apache 2.0 § 5 covers this automatically — no separate CLA).

## Security

Do **not** file security issues as public GitHub issues. See [`SECURITY.md`](./SECURITY.md).
