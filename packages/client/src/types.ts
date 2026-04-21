import type { Keypair } from "@solana/web3.js";

export type BalanceLocation = "base" | "ephemeral";
export type TransferVisibility = "public" | "private";

export interface Px402ClientConfig {
  /** Payer keypair. Signs deposits, withdraws, and payment transfers. */
  wallet: Keypair;
  /** SPL mint address of the payment token (USDC). */
  mint: string;
  /** MagicBlock private-payments REST base. Default: https://payments.magicblock.app */
  apiUrl?: string;
  /** Base chain RPC. Default: https://rpc.magicblock.app/devnet */
  baseRpcUrl?: string;
  /** Ephemeral rollup RPC for PER tx submission. Default: https://devnet.magicblock.app */
  ephemeralRpcUrl?: string;
  /**
   * Cluster identifier forwarded to every REST call. Use "devnet" or "mainnet".
   * The API maps these to its own RPC env vars. Default: "devnet".
   */
  cluster?: "devnet" | "mainnet" | (string & {});
  /** Default visibility for outgoing transfers. Default: "private" */
  visibility?: TransferVisibility;
  /** Default source location for outgoing transfers. Default: "ephemeral" */
  fromBalance?: BalanceLocation;
  /** Default destination location for outgoing transfers. Default: "ephemeral" */
  toBalance?: BalanceLocation;
  /** Retry schedule in ms for the 402 -> pay -> retry flow. Matches locked design. */
  retryDelaysMs?: number[];
  /** Optional custom fetch, for tests. */
  fetch?: typeof fetch;
}

export interface BuiltTransactionResponse {
  kind: "deposit" | "withdraw" | "transfer";
  version: "legacy" | "v0";
  transactionBase64: string;
  sendTo: BalanceLocation;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  instructionCount: number;
  requiredSigners: string[];
  validator?: string;
}

export interface BalanceResponse {
  /** Raw integer amount as a string (e.g. "1000000" = 1.0 USDC). */
  amount: string;
  /** Optional. Not returned by every MagicBlock endpoint variant. */
  decimals?: number;
}

export class Px402ClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "Px402ClientError";
  }
}

export class PaymentRequiredError extends Px402ClientError {
  constructor(message = "Server returned 402 with no payment headers") {
    super(message, "PAYMENT_REQUIRED");
    this.name = "PaymentRequiredError";
  }
}

export class InsufficientBalanceError extends Px402ClientError {
  constructor(
    public readonly required: string,
    public readonly available: string,
  ) {
    super(
      `Insufficient PER balance. Required ${required}, available ${available}`,
      "INSUFFICIENT_BALANCE",
    );
    this.name = "InsufficientBalanceError";
  }
}

export class MaxRetriesExceededError extends Px402ClientError {
  constructor(message = "Max retries exceeded while waiting for payment verification") {
    super(message, "MAX_RETRIES");
    this.name = "MaxRetriesExceededError";
  }
}
