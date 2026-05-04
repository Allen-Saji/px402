/**
 * Provision and cache a pool of funded devnet wallets for the integration suite.
 *
 * Each wallet ends up with:
 *   - 0.05 SOL on devnet base chain (from solana airdrop) — covers signing fees
 *   - 1.0 USDC on the px402 test mint (transferred from the funder wallet)
 *
 * Pool is cached at tests/integration/.tmp/funded-pool.json so subsequent runs
 * skip the slow provisioning step. Pass `--refund` to re-provision.
 *
 * Usage:
 *   pnpm --filter px402-integration-tests fund -- --count 30
 *   pnpm --filter px402-integration-tests fund -- --refund --count 10
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotent,
  getAccount,
  getAssociatedTokenAddressSync,
  transfer,
  TokenAccountNotFoundError,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
  FUNDED_POOL_PATH,
  FUNDER_KEYPAIR_PATH,
  PX402_USDC_MINT,
  TMP_DIR,
} from "./constants.js";
import { keypairFromJsonArray, keypairToJsonArray, loadKeypair } from "./keypair.js";

const SOL_PER_WALLET = 0.05;
const USDC_PER_WALLET = 1_000_000n; // 1.0 USDC in micro-units (6 decimals)
/** Override via `PX402_DEVNET_RPC` to use a less-rate-limited endpoint (Helius, Triton, etc). */
const DEVNET_RPC = process.env.PX402_DEVNET_RPC ?? "https://api.devnet.solana.com";
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1500;

async function withRetry<T>(label: string, op: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient =
        msg.includes("fetch failed") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("429") ||
        msg.includes("503") ||
        msg.includes("blockhash") ||
        msg.includes("timed out");
      if (!transient || attempt === MAX_RETRIES) throw err;
      const wait = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
      console.warn(`[fund-pool] ${label} attempt ${attempt} failed (${msg.slice(0, 80)}); retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

interface FundedWalletEntry {
  publicKey: string;
  secretKey: number[];
  fundedAt: number;
}

interface FundedPool {
  mint: string;
  wallets: FundedWalletEntry[];
}

function readPool(): FundedPool | null {
  if (!existsSync(FUNDED_POOL_PATH)) return null;
  try {
    return JSON.parse(readFileSync(FUNDED_POOL_PATH, "utf8")) as FundedPool;
  } catch {
    return null;
  }
}

function writePool(pool: FundedPool): void {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(FUNDED_POOL_PATH, JSON.stringify(pool, null, 2));
}

export async function ensureFundedWallets(
  count: number,
  options: { refund?: boolean } = {},
): Promise<Keypair[]> {
  const cached = readPool();
  if (!options.refund && cached && cached.mint === PX402_USDC_MINT && cached.wallets.length >= count) {
    return cached.wallets.slice(0, count).map((w) => keypairFromJsonArray(w.secretKey));
  }

  // Re-use what we have, top up to `count`.
  const existing = (!options.refund && cached?.mint === PX402_USDC_MINT ? cached.wallets : []).map(
    (w) => keypairFromJsonArray(w.secretKey),
  );
  const need = count - existing.length;
  const fresh = Array.from({ length: need }, () => Keypair.generate());
  const all = [...existing, ...fresh];

  if (fresh.length > 0) {
    console.log(`[fund-pool] provisioning ${fresh.length} new wallet(s) (have ${existing.length})`);
    await provisionWallets(fresh);
  }

  const pool: FundedPool = {
    mint: PX402_USDC_MINT,
    wallets: all.map((kp) => ({
      publicKey: kp.publicKey.toBase58(),
      secretKey: keypairToJsonArray(kp),
      fundedAt: Date.now(),
    })),
  };
  writePool(pool);
  console.log(`[fund-pool] cached ${all.length} wallet(s) at ${FUNDED_POOL_PATH}`);
  return all;
}

async function provisionWallets(wallets: Keypair[]): Promise<void> {
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const funder = loadKeypair(FUNDER_KEYPAIR_PATH);
  const mint = new PublicKey(PX402_USDC_MINT);
  const funderAta = getAssociatedTokenAddressSync(mint, funder.publicKey);

  // Sanity check: funder has the mint account.
  try {
    await getAccount(connection, funderAta);
  } catch (err) {
    if (err instanceof TokenAccountNotFoundError) {
      throw new Error(
        `Funder ATA ${funderAta.toBase58()} not found. Funder wallet ${funder.publicKey.toBase58()} must hold ${PX402_USDC_MINT} on devnet.`,
      );
    }
    throw err;
  }

  for (const wallet of wallets) {
    await fundOne(connection, funder, wallet, funderAta, mint);
  }
}

async function fundOne(
  connection: Connection,
  funder: Keypair,
  wallet: Keypair,
  funderAta: PublicKey,
  mint: PublicKey,
): Promise<void> {
  const pubkey = wallet.publicKey.toBase58();

  // Step 1: airdrop SOL with retry, fallback to funder-funded transfer.
  const balance = await withRetry(`getBalance(${pubkey})`, () => connection.getBalance(wallet.publicKey));
  const needLamports = SOL_PER_WALLET * LAMPORTS_PER_SOL - balance;
  if (needLamports > 0) {
    try {
      await withRetry(`airdrop(${pubkey})`, async () => {
        const sig = await connection.requestAirdrop(wallet.publicKey, Math.ceil(needLamports));
        await connection.confirmTransaction(sig, "confirmed");
      });
      console.log(`[fund-pool] airdropped ${SOL_PER_WALLET} SOL to ${pubkey}`);
    } catch (err) {
      console.warn(`[fund-pool] airdrop failed for ${pubkey}, falling back to funder transfer`);
      const { Transaction, SystemProgram } = await import("@solana/web3.js");
      await withRetry(`funder->wallet SOL transfer(${pubkey})`, async () => {
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: funder.publicKey,
            toPubkey: wallet.publicKey,
            lamports: Math.ceil(needLamports),
          }),
        );
        const sig = await connection.sendTransaction(tx, [funder]);
        await connection.confirmTransaction(sig, "confirmed");
      });
      console.log(`[fund-pool] funder-transferred ${SOL_PER_WALLET} SOL to ${pubkey}`);
    }
  }

  // Step 2: ensure ATA exists for the wallet on the px402 mint.
  const walletAta = await withRetry(`createATA(${pubkey})`, () =>
    createAssociatedTokenAccountIdempotent(connection, funder, mint, wallet.publicKey),
  );

  // Step 3: spl-transfer USDC from funder to wallet (top up to 1 USDC).
  let currentUsdc = 0n;
  try {
    const acc = await withRetry(`getAccount(${walletAta.toBase58()})`, () =>
      getAccount(connection, walletAta),
    );
    currentUsdc = acc.amount;
  } catch (err) {
    if (!(err instanceof TokenAccountNotFoundError)) throw err;
  }
  const needUsdc = USDC_PER_WALLET - currentUsdc;
  if (needUsdc > 0n) {
    await withRetry(`spl-transfer USDC(${pubkey})`, async () => {
      const sig = await transfer(connection, funder, funderAta, walletAta, funder, Number(needUsdc));
      await connection.confirmTransaction(sig, "confirmed");
    });
    console.log(`[fund-pool] transferred ${needUsdc} micro-USDC to ${pubkey}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const refund = args.includes("--refund");
  const countIdx = args.indexOf("--count");
  const count = countIdx >= 0 ? Number(args[countIdx + 1] ?? 10) : 10;
  ensureFundedWallets(count, { refund })
    .then((wallets) => {
      console.log(`[fund-pool] ready with ${wallets.length} wallet(s)`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[fund-pool] failed:", err);
      process.exit(1);
    });
}
