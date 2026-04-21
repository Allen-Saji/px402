/**
 * One-off ops script: initialize a server wallet's PER state by performing
 * a small self-deposit. Creates and delegates the server's ephemeral ATA so
 * the wallet can receive px402 payments.
 *
 * Env:
 *   SERVER_KEYPAIR_PATH  default: ~/.config/solana/px402-server.json
 *   PX402_MINT           default: devnet USDC mint
 *   INIT_AMOUNT          default: 10000 (0.01 test-USDC, in micro units)
 *
 * Precondition: the server wallet must have INIT_AMOUNT on the base chain
 * (i.e. its associated token account funded), plus enough SOL for rent.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Px402Client } from "@px402/client";
import { Keypair } from "@solana/web3.js";

const keypairPath =
  process.env.SERVER_KEYPAIR_PATH ?? join(homedir(), ".config/solana/px402-server.json");
const mint = process.env.PX402_MINT ?? "5CmxDcDtDiqwxy9TDVyo1Xjr4AFwQzrH7vKr8cXfkEse";
const amount = BigInt(process.env.INIT_AMOUNT ?? "10000");

const wallet = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")) as number[]),
);
console.log(`server wallet: ${wallet.publicKey.toBase58()}`);
console.log(`depositing ${amount} micro-units of ${mint} to init PER side`);

const client = new Px402Client({ wallet, mint });
const sig = await client.deposit(amount);
console.log(`deposit sig: ${sig}`);
