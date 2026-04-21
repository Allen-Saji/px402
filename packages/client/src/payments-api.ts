import { Connection, Keypair, Transaction } from "@solana/web3.js";
import type { BalanceResponse, BuiltTransactionResponse } from "./types.js";
import { Px402ClientError } from "./types.js";

/**
 * Thin wrapper over the MagicBlock Private Payments REST API.
 *
 * Responsibilities:
 * - POST to /v1/spl/{deposit, transfer, withdraw}, receive unsigned tx
 * - Sign with the configured keypair
 * - Submit to the correct RPC based on `sendTo` in the response
 * - Confirm against the returned blockhash + lastValidBlockHeight
 *
 * No retry logic here. Higher-level wrappers (fetch flow) own retries.
 */
export class PaymentsApi {
  constructor(
    private readonly cfg: {
      wallet: Keypair;
      mint: string;
      apiUrl: string;
      baseRpcUrl: string;
      ephemeralRpcUrl: string;
      cluster: string;
      privacy: "private" | "public";
      fetch: typeof fetch;
    },
  ) {}

  async deposit(amount: bigint): Promise<string> {
    const body = {
      owner: this.cfg.wallet.publicKey.toBase58(),
      amount: toSafeInt(amount),
      mint: this.cfg.mint,
      cluster: this.cfg.cluster,
      initIfMissing: true,
      initVaultIfMissing: true,
    };
    const built = await this.postBuild("/v1/spl/deposit", body);
    return this.signAndSubmit(built);
  }

  async withdraw(amount: bigint): Promise<string> {
    const body = {
      owner: this.cfg.wallet.publicKey.toBase58(),
      amount: toSafeInt(amount),
      mint: this.cfg.mint,
      cluster: this.cfg.cluster,
    };
    const built = await this.postBuild("/v1/spl/withdraw", body);
    return this.signAndSubmit(built);
  }

  async transfer(opts: {
    destination: string;
    amount: bigint;
    memo?: string;
  }): Promise<string> {
    const body = {
      from: this.cfg.wallet.publicKey.toBase58(),
      to: opts.destination,
      amount: toSafeInt(opts.amount),
      mint: this.cfg.mint,
      cluster: this.cfg.cluster,
      visibility: this.cfg.privacy,
      fromBalance: "ephemeral",
      toBalance: "ephemeral",
      ...(opts.memo ? { memo: opts.memo } : {}),
    };
    const built = await this.postBuild("/v1/spl/transfer", body);
    return this.signAndSubmit(built);
  }

  async baseBalance(): Promise<BalanceResponse> {
    return this.getBalance("/v1/spl/balance");
  }

  async privateBalance(): Promise<BalanceResponse> {
    return this.getBalance("/v1/spl/private-balance");
  }

  private async postBuild(
    path: string,
    body: Record<string, unknown>,
  ): Promise<BuiltTransactionResponse> {
    const res = await this.cfg.fetch(`${this.cfg.apiUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Px402ClientError(
        `${path} HTTP ${res.status}: ${text}`,
        "API_ERROR",
      );
    }
    return (await res.json()) as BuiltTransactionResponse;
  }

  private async getBalance(path: string): Promise<BalanceResponse> {
    const url = new URL(`${this.cfg.apiUrl}${path}`);
    url.searchParams.set("address", this.cfg.wallet.publicKey.toBase58());
    url.searchParams.set("mint", this.cfg.mint);
    url.searchParams.set("cluster", this.cfg.cluster);
    const res = await this.cfg.fetch(url.toString());
    if (!res.ok) {
      const text = await res.text();
      throw new Px402ClientError(
        `${path} HTTP ${res.status}: ${text}`,
        "API_ERROR",
      );
    }
    const json = (await res.json()) as { balance: string; decimals?: number };
    return {
      amount: json.balance,
      ...(json.decimals !== undefined ? { decimals: json.decimals } : {}),
    };
  }

  private async signAndSubmit(built: BuiltTransactionResponse): Promise<string> {
    const raw = Buffer.from(built.transactionBase64, "base64");
    const tx = Transaction.from(raw);
    tx.sign(this.cfg.wallet);

    const rpcUrl =
      built.sendTo === "ephemeral" ? this.cfg.ephemeralRpcUrl : this.cfg.baseRpcUrl;
    const connection = new Connection(rpcUrl, "confirmed");

    const signature = await connection.sendRawTransaction(tx.serialize(), {
      // Preflight fails on ER for private transfers due to account-delegation
      // semantics the simulator doesn't model; the real ER runtime checks
      // delegation post-submit. Surface errors via getTransaction instead.
      skipPreflight: true,
      maxRetries: 3,
    });

    await connection.confirmTransaction(
      {
        signature,
        blockhash: built.recentBlockhash,
        lastValidBlockHeight: built.lastValidBlockHeight,
      },
      "confirmed",
    );

    return signature;
  }
}

function toSafeInt(amount: bigint): number {
  if (amount <= 0n) throw new Px402ClientError("amount must be positive", "BAD_AMOUNT");
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Px402ClientError(
      `amount ${amount} exceeds MAX_SAFE_INTEGER; REST API uses JSON numbers`,
      "BAD_AMOUNT",
    );
  }
  return Number(amount);
}
