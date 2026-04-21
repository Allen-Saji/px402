import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  ExpiredTokenError,
  InvalidTokenError,
  type PaymentTokenPayload,
  type Px402CoreConfig,
  type SecretConfig,
} from "./types.js";

const TOKEN_VERSION = "v1";
const DEFAULT_TTL_MS = 5 * 60 * 1000;

function toB64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromB64Url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

function normalizeSecret(secret: string | SecretConfig): SecretConfig {
  return typeof secret === "string" ? { current: secret } : secret;
}

/**
 * Generate a u63 decimal-string identifier suitable for MagicBlock's
 * `clientRefId` field. Using 63 bits keeps us safely inside JS Number and
 * well inside u64 while still giving 9e18 possible values per process.
 */
function generateClientRefId(): string {
  const buf = randomBytes(8);
  // Clear the top bit so the result fits in a signed 64-bit range and avoids
  // any risk of tripping sign-sensitive decoders downstream.
  buf[0] = (buf[0] as number) & 0x7f;
  return BigInt("0x" + buf.toString("hex")).toString();
}

export interface CreateTokenInput {
  path: string;
  destination: string;
  amount: string;
  ttlMs?: number;
  now?: number;
}

export interface CreatedToken {
  paymentId: string;
  token: string;
  expiry: number;
}

export function createPaymentToken(
  config: Pick<Px402CoreConfig, "serverSecret" | "tokenTtlMs">,
  input: CreateTokenInput,
): CreatedToken {
  if (!/^\d+$/.test(input.amount)) {
    throw new InvalidTokenError("amount must be an integer string");
  }
  if (!input.path || !input.destination) {
    throw new InvalidTokenError("path and destination are required");
  }

  const secret = normalizeSecret(config.serverSecret);
  const now = input.now ?? Date.now();
  const ttl = input.ttlMs ?? config.tokenTtlMs ?? DEFAULT_TTL_MS;
  const paymentId = generateClientRefId();

  const payload: PaymentTokenPayload = {
    paymentId,
    amount: input.amount,
    expiry: now + ttl,
    path: input.path,
    destination: input.destination,
  };

  const payloadB64 = toB64Url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sigB64 = toB64Url(sign(secret.current, `${TOKEN_VERSION}.${payloadB64}`));

  return {
    paymentId,
    token: `${TOKEN_VERSION}.${payloadB64}.${sigB64}`,
    expiry: payload.expiry,
  };
}

export function verifyPaymentToken(
  config: Pick<Px402CoreConfig, "serverSecret">,
  token: string,
  now: number = Date.now(),
): PaymentTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new InvalidTokenError("malformed token");
  const [version, payloadB64, sigB64] = parts as [string, string, string];
  if (version !== TOKEN_VERSION) throw new InvalidTokenError("unknown token version");

  const secret = normalizeSecret(config.serverSecret);
  const signingInput = `${version}.${payloadB64}`;
  const providedSig = fromB64Url(sigB64);

  const candidates: string[] = [secret.current];
  if (secret.previous) candidates.push(secret.previous);

  let matched = false;
  for (const key of candidates) {
    const expected = sign(key, signingInput);
    if (expected.length === providedSig.length && timingSafeEqual(expected, providedSig)) {
      matched = true;
      break;
    }
  }
  if (!matched) throw new InvalidTokenError("signature mismatch");

  let payload: PaymentTokenPayload;
  try {
    payload = JSON.parse(fromB64Url(payloadB64).toString("utf8")) as PaymentTokenPayload;
  } catch {
    throw new InvalidTokenError("payload is not valid JSON");
  }

  if (
    typeof payload.paymentId !== "string" ||
    typeof payload.amount !== "string" ||
    typeof payload.expiry !== "number" ||
    typeof payload.path !== "string" ||
    typeof payload.destination !== "string"
  ) {
    throw new InvalidTokenError("payload is missing required fields");
  }

  if (now >= payload.expiry) {
    throw new ExpiredTokenError();
  }

  return payload;
}
