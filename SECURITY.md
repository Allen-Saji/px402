# Security policy

## Supported versions

px402 is pre-alpha (0.1.x). Only the latest minor release is supported.

| Version | Supported |
|---|---|
| 0.1.x | yes |
| < 0.1 | no |

## Reporting a vulnerability

**Do not** open public GitHub issues for security problems.

Use GitHub's private vulnerability reporting:

→ https://github.com/Allen-Saji/px402/security/advisories/new

Or, if you can't use GitHub, email **allensaji04@gmail.com** with subject `[px402 security]`.

Please include:

- Affected package(s) and version
- A description of the issue and its impact
- Steps to reproduce, or a proof-of-concept
- Your suggested fix or mitigation, if any

You should receive an acknowledgement within **72 hours**. We aim to ship a fix or mitigation within **14 days** for high-severity issues.

## What's in scope

- HMAC payment-token forgery, replay, or downgrade
- Rate-limit bypass
- Subscriber state corruption or denial-of-service via crafted on-chain logs
- Token-balance delta parsing exploits (sender/receiver/amount mismatch)
- Stale-blockhash retry race conditions
- Server-secret leakage paths

## What's out of scope

- Vulnerabilities in MagicBlock's REST API or RPC infrastructure — report those to MagicBlock directly.
- Vulnerabilities in Solana, `@solana/web3.js`, `@solana/spl-token`, or upstream framework packages — report those upstream.
- DoS via legitimate high-volume payment traffic (this is what rate-limit config is for).
- Issues that require an already-compromised server keypair or HMAC secret.

## Coordinated disclosure

After a fix ships, we will credit you in the release notes unless you ask to stay anonymous.
