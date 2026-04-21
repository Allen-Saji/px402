import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/rate-limit.js";

describe("RateLimiter", () => {
  it("IP limit allows up to N requests then blocks", () => {
    const rl = new RateLimiter({ issuePerIpPerMinute: 3, windowMs: 60_000 });
    const now = 1_700_000_000_000;
    expect(rl.checkIssue("1.1.1.1", now).ok).toBe(true);
    expect(rl.checkIssue("1.1.1.1", now).ok).toBe(true);
    expect(rl.checkIssue("1.1.1.1", now).ok).toBe(true);
    const fourth = rl.checkIssue("1.1.1.1", now);
    expect(fourth.ok).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it("IP buckets are independent across IPs", () => {
    const rl = new RateLimiter({ issuePerIpPerMinute: 1, windowMs: 60_000 });
    const now = 1_700_000_000_000;
    expect(rl.checkIssue("1.1.1.1", now).ok).toBe(true);
    expect(rl.checkIssue("1.1.1.1", now).ok).toBe(false);
    expect(rl.checkIssue("2.2.2.2", now).ok).toBe(true);
  });

  it("wallet bucket is separate from IP bucket", () => {
    const rl = new RateLimiter({
      issuePerIpPerMinute: 1,
      verifyPerWalletPerMinute: 1,
      windowMs: 60_000,
    });
    const now = 1_700_000_000_000;
    expect(rl.checkIssue("1.1.1.1", now).ok).toBe(true);
    expect(rl.checkIssue("1.1.1.1", now).ok).toBe(false);
    expect(rl.checkVerify("walletA", now).ok).toBe(true);
    expect(rl.checkVerify("walletA", now).ok).toBe(false);
    expect(rl.checkVerify("walletB", now).ok).toBe(true);
  });

  it("limit resets after window", () => {
    const rl = new RateLimiter({ issuePerIpPerMinute: 2, windowMs: 60_000 });
    const t0 = 1_700_000_000_000;
    rl.checkIssue("1.1.1.1", t0);
    rl.checkIssue("1.1.1.1", t0);
    expect(rl.checkIssue("1.1.1.1", t0).ok).toBe(false);
    expect(rl.checkIssue("1.1.1.1", t0 + 60_000).ok).toBe(true);
  });

  it("evicts oldest entry when maxEntries exceeded", () => {
    const rl = new RateLimiter({
      issuePerIpPerMinute: 1,
      windowMs: 60_000,
      maxEntries: 2,
    });
    const now = 1_700_000_000_000;
    rl.checkIssue("a", now);
    rl.checkIssue("b", now);
    rl.checkIssue("c", now); // evicts "a"
    // "a" should have a fresh bucket (eviction lost its count)
    expect(rl.checkIssue("a", now).ok).toBe(true);
  });

  it("reports remaining correctly", () => {
    const rl = new RateLimiter({ issuePerIpPerMinute: 3, windowMs: 60_000 });
    const now = 1_700_000_000_000;
    expect(rl.checkIssue("x", now).remaining).toBe(2);
    expect(rl.checkIssue("x", now).remaining).toBe(1);
    expect(rl.checkIssue("x", now).remaining).toBe(0);
  });
});
