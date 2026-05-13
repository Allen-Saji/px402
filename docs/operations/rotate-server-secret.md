# Rotating `PX402_SERVER_SECRET`

The middleware HMAC-signs `X-Payment-Token` with `serverSecret` so the server
stays stateless across the 402-pay-retry window. If that secret leaks (or you
just rotate on a schedule), you can swap it without dropping in-flight
payments by running with two keys for one token-TTL window.

## Why a window is needed

When you swap the secret naively, in-flight tokens signed with the old key
become invalid mid-flight. The agent retries, gets `401 invalid_token`, has
to roll a fresh payment_id, and pays a second time — funds aren't lost but
DX is broken for every active agent at swap moment.

`verifyPaymentToken` (and all three adapter middlewares) accept a key pair:

```ts
serverSecret: { current: NEW_KEY, previous: OLD_KEY }
```

During the overlap window the middleware tries `current` first, then
`previous`. Tokens signed with either key verify. New tokens are always
signed with `current`.

## Procedure

1. **Generate a new 32-byte secret.**

   ```sh
   openssl rand -hex 32
   # e.g. 7d3f9a... (64 hex chars = 32 bytes)
   ```

2. **Roll out config with both keys.** Set:

   ```env
   PX402_SERVER_SECRET={"current":"<new>","previous":"<old>"}
   ```

   Or load it programmatically:

   ```ts
   px402({
     serverSecret: {
       current: process.env.PX402_SERVER_SECRET_NEW!,
       previous: process.env.PX402_SERVER_SECRET_OLD!,
     },
     // ...
   })
   ```

   Deploy. All servers now accept tokens signed with either key, and sign
   new ones with `current`.

3. **Wait at least `tokenTtlMs`.** Default is 5 min. The longest-lived
   outstanding token signed with the old key expires by this point. Wait
   a buffer (e.g. 10 min) if your traffic includes long retry chains or
   you've extended `tokenTtlMs`.

4. **Drop `previous` on the next deploy.**

   ```env
   PX402_SERVER_SECRET=<new>
   ```

   Done.

## Sanity checks

- During the overlap window, monitor `401 invalid_token` rate. It should
  not spike — if it does, your overlap window is shorter than the longest
  token TTL in use, or one of your replicas isn't picking up the new env.
- Never roll a new key without `previous`. Any in-flight payment will 401
  and the agent will pay again.
- Treat `previous` as live secret material until you drop it. Same
  storage, same rotation tracking.

## Failure modes

- **Secret leaked.** Run the procedure above with a fresh `current` and the
  leaked key as `previous`. After the window, the leaked key is dead.
- **Lost the old key.** No problem — you only need `current` going forward.
  Outstanding tokens signed with the lost key will 401 (which is the right
  outcome; you don't want to honor tokens signed with a key you don't
  control).
- **Multi-replica deploys with rolling rollout.** A request can land on an
  old replica during the rollout. That replica only has the old key. Same
  symptom as #1, same mitigation: keep `previous` populated until the
  rollout completes AND the TTL window passes.
