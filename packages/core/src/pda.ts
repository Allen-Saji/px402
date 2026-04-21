import { PublicKey } from "@solana/web3.js";

/** MagicBlock's ephemeral-spl-token program (handles private transfers). */
export const SPL_PP_PROGRAM_ID = new PublicKey(
  "SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2",
);

/**
 * Transfer queue PDA for a given (mint, validator) pair.
 * Seeds: ["queue", mint, validator] under SPL-PP.
 *
 * Every private-transfer crank tick logs to this account. Subscribers watch it
 * via `logsSubscribe({ mentions: [queuePda] })`.
 */
export function deriveQueuePda(mint: PublicKey | string, validator: PublicKey | string): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("queue"),
      new PublicKey(mint).toBuffer(),
      new PublicKey(validator).toBuffer(),
    ],
    SPL_PP_PROGRAM_ID,
  );
  return pda;
}

/**
 * Persistent ephemeral ATA for (wallet, mint).
 * Seeds: [wallet, mint] under SPL-PP.
 *
 * This is the account that accrues PER balance for a wallet on a given mint.
 * Different from the per-transfer shuttle eATA.
 */
export function deriveEphemeralAta(
  wallet: PublicKey | string,
  mint: PublicKey | string,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [new PublicKey(wallet).toBuffer(), new PublicKey(mint).toBuffer()],
    SPL_PP_PROGRAM_ID,
  );
  return pda;
}
