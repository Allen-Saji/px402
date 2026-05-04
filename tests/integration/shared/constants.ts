import { homedir } from "node:os";
import { join } from "node:path";

export const PX402_USDC_MINT = "5CmxDcDtDiqwxy9TDVyo1Xjr4AFwQzrH7vKr8cXfkEse";
export const PX402_VALIDATOR = "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57";
export const PX402_API_URL = "https://payments.magicblock.app";
export const PX402_BASE_RPC_URL = "https://rpc.magicblock.app/devnet";
export const PX402_EPHEMERAL_RPC_URL = "https://devnet.magicblock.app";
export const PX402_CLUSTER = "devnet";

export const FUNDER_KEYPAIR_PATH = join(homedir(), ".config/solana/id.json");
export const TMP_DIR = join(import.meta.dirname, "..", ".tmp");
export const FUNDED_POOL_PATH = join(TMP_DIR, "funded-pool.json");
export const SERVER_KEYPAIR_PATH = join(homedir(), ".config/solana/px402-server.json");

export const DEFAULT_PRICE_MICRO_USDC = "10000"; // 0.01 USDC
