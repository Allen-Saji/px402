/**
 * Resolves the token delta for a signature by calling getTransaction against
 * a Solana-compatible RPC. Used by servers to populate memo -> amount.
 *
 * On MagicBlock ER, always read with `commitment: 'finalized'` because of the
 * inverted commitment ordering.
 */
export interface FetchAmountConfig {
  /** RPC URL for the rollup (e.g. https://devnet.magicblock.app). */
  rpcUrl: string;
  /** The destination wallet that owns the receiving ATA. */
  destinationOwner: string;
  /** The SPL mint we accept. */
  mint: string;
  /** Commitment used by getTransaction. Default "finalized" for ER. */
  commitment?: "processed" | "confirmed" | "finalized";
  /** Optional custom fetch, for tests. */
  fetch?: typeof fetch;
}

interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: {
    amount: string;
    decimals: number;
  };
}

interface GetTransactionResponse {
  jsonrpc: "2.0";
  id: number | string;
  result: {
    meta: {
      err: unknown | null;
      preTokenBalances?: TokenBalance[];
      postTokenBalances?: TokenBalance[];
    } | null;
    slot: number;
  } | null;
  error?: { code: number; message: string };
}

export function createFetchAmount(cfg: FetchAmountConfig) {
  const f = cfg.fetch ?? fetch;
  const commitment = cfg.commitment ?? "finalized";

  return async (signature: string): Promise<string | null> => {
    const body = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "getTransaction",
      params: [
        signature,
        { encoding: "json", commitment, maxSupportedTransactionVersion: 0 },
      ],
    };
    const res = await f(cfg.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`getTransaction HTTP ${res.status}`);
    }
    const json = (await res.json()) as GetTransactionResponse;
    if (json.error) {
      throw new Error(`getTransaction RPC error: ${json.error.message}`);
    }
    const result = json.result;
    if (!result || !result.meta || result.meta.err) return null;

    const pre = result.meta.preTokenBalances ?? [];
    const post = result.meta.postTokenBalances ?? [];

    for (const entry of post) {
      if (entry.mint !== cfg.mint) continue;
      if (entry.owner !== cfg.destinationOwner) continue;
      const preEntry = pre.find(
        (p) => p.accountIndex === entry.accountIndex && p.mint === entry.mint,
      );
      const preAmount = BigInt(preEntry?.uiTokenAmount.amount ?? "0");
      const postAmount = BigInt(entry.uiTokenAmount.amount);
      const delta = postAmount - preAmount;
      if (delta > 0n) return delta.toString();
    }
    return null;
  };
}
