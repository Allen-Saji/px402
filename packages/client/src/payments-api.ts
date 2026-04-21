import {
  Connection,
  Keypair,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import type {
  BalanceLocation,
  BalanceResponse,
  BuiltTransactionResponse,
  TransferVisibility,
} from "./types.js";
import { Px402ClientError } from "./types.js";

/**
 * Thin wrapper over the MagicBlock Private Payments REST API.
 *
 * Responsibilities:
 * - POST to /v1/spl/{deposit, transfer, withdraw}, receive unsigned tx
 * - Sign with the configured keypair
 * - Submit to the correct RPC based on `sendTo` in the response
 * - Confirm against the returned blockhash + lastValidBlockHeight
 * - Manage a signed-challenge bearer token for /private-balance
 *
 * No retry logic here. Higher-level wrappers (fetch flow) own retries.
 */
export class PaymentsApi {
  private authToken: string | null = null;

  constructor(
    private readonly cfg: {
      wallet: Keypair;
      mint: string;
      apiUrl: string;
      baseRpcUrl: string;
      ephemeralRpcUrl: string;
      cluster: string;
      visibility: TransferVisibility;
      fromBalance: BalanceLocation;
      toBalance: BalanceLocation;
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
    /** Recipient wallet pubkey (not ATA). The API derives the correct target account. */
    destination: string;
    amount: bigint;
    /**
     * Decimal-string u64 identifier. Encrypted into the private transfer
     * payload and echoed verbatim in the crank's tick log (`client_ref_id`).
     * The server looks this up to confirm the payment.
     */
    clientRefId?: string;
    /** Override the default fromBalance per-call. */
    fromBalance?: BalanceLocation;
    /** Override the default toBalance per-call. */
    toBalance?: BalanceLocation;
    /** Override the default visibility per-call. */
    visibility?: TransferVisibility;
    /**
     * Include PDA initialization instructions atomically. Needed on the very
     * first transfer for a new sender+validator+mint triple. Default false
     * because MagicBlock's API currently only returns legacy transactions and
     * the init-heavy form exceeds the 1232-byte cap.
     */
    init?: boolean;
  }): Promise<string> {
    const withInit = opts.init ?? false;
    const body = {
      from: this.cfg.wallet.publicKey.toBase58(),
      to: opts.destination,
      amount: toSafeInt(opts.amount),
      mint: this.cfg.mint,
      cluster: this.cfg.cluster,
      visibility: opts.visibility ?? this.cfg.visibility,
      fromBalance: opts.fromBalance ?? this.cfg.fromBalance,
      toBalance: opts.toBalance ?? this.cfg.toBalance,
      ...(withInit
        ? { initIfMissing: true, initAtasIfMissing: true, initVaultIfMissing: true }
        : {}),
      ...(opts.clientRefId ? { clientRefId: opts.clientRefId } : {}),
    };
    const built = await this.postBuild("/v1/spl/transfer", body);
    return this.signAndSubmit(built);
  }

  async baseBalance(): Promise<BalanceResponse> {
    return this.getBalance("/v1/spl/balance", false);
  }

  async privateBalance(): Promise<BalanceResponse> {
    return this.getBalance("/v1/spl/private-balance", true);
  }

  /**
   * Signed-challenge login. Caches the token so private-balance reads reuse
   * a single auth handshake per client instance.
   */
  async authenticate(): Promise<string> {
    if (this.authToken) return this.authToken;

    const pubkey = this.cfg.wallet.publicKey.toBase58();
    const challengeUrl = new URL(`${this.cfg.apiUrl}/v1/spl/challenge`);
    challengeUrl.searchParams.set("pubkey", pubkey);
    challengeUrl.searchParams.set("cluster", this.cfg.cluster);
    const challengeRes = await this.cfg.fetch(challengeUrl.toString());
    if (!challengeRes.ok) {
      throw new Px402ClientError(
        `challenge HTTP ${challengeRes.status}: ${await challengeRes.text()}`,
        "API_ERROR",
      );
    }
    const { challenge } = (await challengeRes.json()) as { challenge: string };

    const signature = signChallenge(challenge, this.cfg.wallet);
    const loginRes = await this.cfg.fetch(`${this.cfg.apiUrl}/v1/spl/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pubkey,
        challenge,
        signature,
        cluster: this.cfg.cluster,
      }),
    });
    if (!loginRes.ok) {
      throw new Px402ClientError(
        `login HTTP ${loginRes.status}: ${await loginRes.text()}`,
        "API_ERROR",
      );
    }
    const { token } = (await loginRes.json()) as { token: string };
    this.authToken = token;
    return token;
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

  private async getBalance(
    path: string,
    requiresAuth: boolean,
  ): Promise<BalanceResponse> {
    const url = new URL(`${this.cfg.apiUrl}${path}`);
    url.searchParams.set("address", this.cfg.wallet.publicKey.toBase58());
    url.searchParams.set("mint", this.cfg.mint);
    url.searchParams.set("cluster", this.cfg.cluster);

    const headers: Record<string, string> = {};
    if (requiresAuth) {
      const token = await this.authenticate();
      headers.authorization = `Bearer ${token}`;
    }

    const res = await this.cfg.fetch(url.toString(), { headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Px402ClientError(
        `${path} HTTP ${res.status}: ${text}`,
        "API_ERROR",
      );
    }
    const json = (await res.json()) as {
      balance: string;
      decimals?: number;
      ata?: string;
      location?: BalanceLocation;
    };
    return {
      amount: json.balance,
      ...(json.decimals !== undefined ? { decimals: json.decimals } : {}),
    };
  }

  private async signAndSubmit(built: BuiltTransactionResponse): Promise<string> {
    const raw = Buffer.from(built.transactionBase64, "base64");
    const rpcUrl =
      built.sendTo === "ephemeral" ? this.cfg.ephemeralRpcUrl : this.cfg.baseRpcUrl;
    const connection = new Connection(rpcUrl, "confirmed");

    const serialized = built.version === "v0" ? signV0(raw, this.cfg.wallet) : signLegacy(raw, this.cfg.wallet);

    const signature = await connection.sendRawTransaction(serialized, {
      // ER enforces delegation after submit in ways the simulator does not
      // model. Preflight false-positives on valid private transfers, so skip.
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

function signLegacy(raw: Buffer, wallet: Keypair): Buffer {
  const tx = Transaction.from(raw);
  tx.sign(wallet);
  return Buffer.from(tx.serialize());
}

function signV0(raw: Buffer, wallet: Keypair): Buffer {
  const tx = VersionedTransaction.deserialize(raw);
  tx.sign([wallet]);
  return Buffer.from(tx.serialize());
}

function signChallenge(challenge: string, wallet: Keypair): string {
  const message = Buffer.from(challenge, "utf8");
  const signature = nacl.sign.detached(message, wallet.secretKey);
  return Buffer.from(signature).toString("base64");
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
