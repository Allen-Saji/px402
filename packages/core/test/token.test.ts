import { describe, expect, it } from "vitest";
import {
  createPaymentToken,
  verifyPaymentToken,
} from "../src/token.js";
import {
  ExpiredTokenError,
  InvalidTokenError,
} from "../src/types.js";

const cfg = { serverSecret: "test-secret-current-key" };
const rotCfg = {
  serverSecret: { current: "new-key", previous: "old-key" },
};

const input = {
  path: "/api/sentiment",
  destination: "3PkQ4JM6WWWEpxoaQtFczYgn47ZkMmdFWySSBfGVVh6v",
  amount: "10000", // 0.01 USDC in micro-units
};

describe("createPaymentToken", () => {
  it("returns {paymentId, token, expiry}", () => {
    const out = createPaymentToken(cfg, input);
    // paymentId is now a decimal-string u63
    expect(out.paymentId).toMatch(/^\d+$/);
    expect(BigInt(out.paymentId)).toBeLessThan(1n << 63n);
    expect(out.token.split(".")).toHaveLength(3);
    expect(out.expiry).toBeGreaterThan(Date.now());
  });

  it("honors explicit ttlMs", () => {
    const now = 1_700_000_000_000;
    const out = createPaymentToken(cfg, { ...input, ttlMs: 1000, now });
    expect(out.expiry).toBe(now + 1000);
  });

  it("rejects non-integer amounts", () => {
    expect(() => createPaymentToken(cfg, { ...input, amount: "0.01" })).toThrow(InvalidTokenError);
    expect(() => createPaymentToken(cfg, { ...input, amount: "10_000" })).toThrow(InvalidTokenError);
  });

  it("rejects empty path/destination", () => {
    expect(() => createPaymentToken(cfg, { ...input, path: "" })).toThrow(InvalidTokenError);
    expect(() => createPaymentToken(cfg, { ...input, destination: "" })).toThrow(InvalidTokenError);
  });
});

describe("verifyPaymentToken", () => {
  it("round-trips payload fields", () => {
    const { token } = createPaymentToken(cfg, input);
    const payload = verifyPaymentToken(cfg, token);
    expect(payload.amount).toBe(input.amount);
    expect(payload.path).toBe(input.path);
    expect(payload.destination).toBe(input.destination);
    expect(payload.paymentId).toMatch(/^\d+$/);
  });

  it("rejects malformed token", () => {
    expect(() => verifyPaymentToken(cfg, "garbage")).toThrow(InvalidTokenError);
    expect(() => verifyPaymentToken(cfg, "a.b")).toThrow(InvalidTokenError);
  });

  it("rejects unknown version", () => {
    const { token } = createPaymentToken(cfg, input);
    const [, payload, sig] = token.split(".");
    expect(() => verifyPaymentToken(cfg, `v9.${payload}.${sig}`)).toThrow(InvalidTokenError);
  });

  it("rejects tampered payload", () => {
    const { token } = createPaymentToken(cfg, input);
    const parts = token.split(".");
    // Flip one char in the payload
    const payload = parts[1]!;
    parts[1] = payload.slice(0, -1) + (payload.at(-1) === "A" ? "B" : "A");
    expect(() => verifyPaymentToken(cfg, parts.join("."))).toThrow(InvalidTokenError);
  });

  it("rejects tampered signature", () => {
    const { token } = createPaymentToken(cfg, input);
    const parts = token.split(".");
    parts[2] = "AAAA" + parts[2]!.slice(4);
    expect(() => verifyPaymentToken(cfg, parts.join("."))).toThrow(InvalidTokenError);
  });

  it("rejects expired token", () => {
    const now = 1_700_000_000_000;
    const { token } = createPaymentToken(cfg, { ...input, now, ttlMs: 1000 });
    expect(() => verifyPaymentToken(cfg, token, now + 1001)).toThrow(ExpiredTokenError);
  });

  it("accepts token signed with previous key during rotation", () => {
    const oldCfg = { serverSecret: "old-key" };
    const { token } = createPaymentToken(oldCfg, input);
    const payload = verifyPaymentToken(rotCfg, token);
    expect(payload.amount).toBe(input.amount);
  });

  it("rejects token signed by unknown third key", () => {
    const thirdCfg = { serverSecret: "third-key" };
    const { token } = createPaymentToken(thirdCfg, input);
    expect(() => verifyPaymentToken(rotCfg, token)).toThrow(InvalidTokenError);
  });
});
