/**
 * px402 Phase 1 round-trip client.
 *
 * Exercises the full flow over HTTP:
 *   1. GET /api/sentiment -> 402 with payment headers
 *   2. POST /__dev/memo (simulates a real PER transfer landing)
 *   3. GET /api/sentiment + X-Payment-{Id,Token} -> 200 with data
 *
 * Phase 2 replaces step 2 with a real MagicBlock PER /v1/spl/transfer call
 * plus sendRawTransaction to the ephemeral RPC.
 */
const BASE = process.env.PX402_SERVER ?? "http://localhost:8787";
const PATH = "/api/sentiment";
const RETRY_DELAYS_MS = [500, 1000, 2000];

interface Payment402 {
  amount: string;
  currency: string;
  network: string;
  destination: string;
  paymentId: string;
  token: string;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithPayment(path: string): Promise<unknown> {
  // Step 1: unauthenticated call, expect 402.
  const r402 = await fetch(`${BASE}${path}`);
  if (r402.status !== 402) {
    throw new Error(`expected 402, got ${r402.status}`);
  }

  const payment: Payment402 = {
    amount: required(r402.headers.get("X-Payment-Amount"), "X-Payment-Amount"),
    currency: required(r402.headers.get("X-Payment-Currency"), "X-Payment-Currency"),
    network: required(r402.headers.get("X-Payment-Network"), "X-Payment-Network"),
    destination: required(r402.headers.get("X-Payment-Address"), "X-Payment-Address"),
    paymentId: required(r402.headers.get("X-Payment-Id"), "X-Payment-Id"),
    token: required(r402.headers.get("X-Payment-Token"), "X-Payment-Token"),
  };
  console.log(
    `[client] 402 received. network=${payment.network} amount=${payment.amount} ${payment.currency}`,
  );
  console.log(`[client]   paymentId=${payment.paymentId}`);

  // Step 2: pay. Phase 1 uses the dev-only /__dev/memo endpoint as a stand-in.
  const signature = `sim-${payment.paymentId.slice(0, 8)}-${Date.now()}`;
  const payRes = await fetch(`${BASE}/__dev/memo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      memo: payment.paymentId,
      signature,
      amount: payment.amount,
    }),
  });
  if (!payRes.ok) {
    throw new Error(`payment simulator failed: ${payRes.status}`);
  }
  console.log(`[client] payment simulated. signature=${signature}`);

  // Step 3: retry with payment headers, using the design-locked backoff schedule.
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      headers: {
        "X-Payment-Id": payment.paymentId,
        "X-Payment-Token": payment.token,
      },
    });
    if (res.status === 200) {
      const sig = res.headers.get("X-Payment-Signature");
      console.log(
        `[client] 200 OK after attempt=${attempt + 1} sig=${sig}`,
      );
      return await res.json();
    }
    if (res.status !== 402) {
      throw new Error(`unexpected ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as { error?: string };
    if (attempt >= RETRY_DELAYS_MS.length) break;
    const delay = RETRY_DELAYS_MS[attempt]!;
    console.log(
      `[client] 402 (${body.error ?? "unknown"}), retrying in ${delay}ms`,
    );
    await sleep(delay);
  }
  throw new Error("max retries exhausted");
}

function required(v: string | null, name: string): string {
  if (!v) throw new Error(`missing header ${name}`);
  return v;
}

async function main() {
  console.log(`[client] px402 round-trip demo against ${BASE}${PATH}`);
  const data = await fetchWithPayment(PATH);
  console.log("[client] response:", data);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
