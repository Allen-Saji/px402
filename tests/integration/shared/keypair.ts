import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";

export function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function keypairToJsonArray(kp: Keypair): number[] {
  return Array.from(kp.secretKey);
}

export function keypairFromJsonArray(arr: number[]): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}
