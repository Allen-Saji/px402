/**
 * Server keypair management. The demo-apis server only needs a pubkey for the
 * receiver filter (it doesn't sign anything for the basic flow), but we keep a
 * persistent keypair so payments accrue to a known address across runs.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Keypair } from "@solana/web3.js";
import { keypairToJsonArray, loadKeypair } from "./keypair.js";
import { SERVER_KEYPAIR_PATH } from "./constants.js";

export function ensureServerKeypair(): Keypair {
  if (existsSync(SERVER_KEYPAIR_PATH)) {
    return loadKeypair(SERVER_KEYPAIR_PATH);
  }
  const dir = dirname(SERVER_KEYPAIR_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const kp = Keypair.generate();
  writeFileSync(SERVER_KEYPAIR_PATH, JSON.stringify(keypairToJsonArray(kp)));
  return kp;
}
