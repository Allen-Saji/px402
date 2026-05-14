// Centralized constants for the site. The deployment URLs and creator credit
// fields read from NEXT_PUBLIC_* env vars at build time so anyone running a
// fork of the site (Vercel preview, internal mirror, downstream protocol
// fork) can override them without touching code. See apps/site/.env.example.

const env = (key: string, fallback: string): string => {
  if (typeof process !== "undefined" && process.env && process.env[key]) {
    return process.env[key] as string;
  }
  return fallback;
};

export const SITE = {
  name: "px402",
  description:
    "Private agentic payments. An HTTP layer over MagicBlock's Private Ephemeral Rollups. Agents pay USDC for APIs. The recipient stays hidden.",

  // Deployment URLs — override per-fork via NEXT_PUBLIC_* env vars.
  url: env("NEXT_PUBLIC_SITE_URL", "https://px402.allensaji.dev"),
  demoApiBase: env("NEXT_PUBLIC_DEMO_API_BASE", "https://api.px402.allensaji.dev"),

  // Project repo (fixed — the canonical upstream).
  githubRepo: "Allen-Saji/px402",
  githubUrl: "https://github.com/Allen-Saji/px402",

  // Creator credit — overridable for forks.
  authorName: env("NEXT_PUBLIC_AUTHOR_NAME", "Allen Saji"),
  authorUrl: env("NEXT_PUBLIC_AUTHOR_URL", "https://allensaji.dev"),
  twitterHandle: env("NEXT_PUBLIC_TWITTER_HANDLE", "@SajiBhai011"),
  twitterUrl: env("NEXT_PUBLIC_TWITTER_URL", "https://x.com/SajiBhai011"),

  // External refs (do not change per fork).
  magicblockUrl: "https://magicblock.app",
  x402Url: "https://x402.org",
};

export const DEMO_ENDPOINTS = [
  {
    path: "/api/sentiment?token=SOL",
    price: "0.01 USDC",
    purpose: "bullish / bearish / neutral + confidence",
  },
  {
    path: "/api/whales?min=100000",
    price: "0.02 USDC",
    purpose: "recent large transfers",
  },
  {
    path: "/api/risk?address=...",
    price: "0.03 USDC",
    purpose: "wallet risk score + signal flags",
  },
] as const;

export const PACKAGES = [
  {
    name: "@px402/core",
    purpose: "HMAC tokens, crank-log subscriber, framework-agnostic decide().",
  },
  {
    name: "@px402/hono",
    purpose: "Hono middleware.",
  },
  {
    name: "@px402/express",
    purpose: "Express middleware.",
  },
  {
    name: "@px402/next",
    purpose: "Next.js App Router HOC.",
  },
  {
    name: "@px402/client",
    purpose: "fetch wrapper. deposit / transfer / balance / privateBalance.",
  },
  {
    name: "@px402/mcp",
    purpose: "MCP server. px402_fetch, px402_balance.",
  },
] as const;

export const PRIMARY_CURL = `curl ${SITE.demoApiBase}/api/sentiment?token=SOL`;
