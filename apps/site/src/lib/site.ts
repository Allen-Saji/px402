// Centralized constants for the site. Swap these in one place when the demo
// API or repo URL changes (e.g. when Railway domain is wired up).

export const SITE = {
  name: "px402",
  description:
    "Private agentic payments. An HTTP layer over MagicBlock's Private Ephemeral Rollups. Agents pay USDC for APIs. The recipient stays hidden.",
  url: "https://px402.allensaji.dev",
  githubRepo: "Allen-Saji/px402",
  githubUrl: "https://github.com/Allen-Saji/px402",
  twitterUrl: "https://x.com/SajiBhai011",
  authorUrl: "https://allensaji.dev",
  authorName: "Allen Saji",
  // Demo API base. Will be swapped to the Railway URL when wired up.
  demoApiBase: "https://api.px402.allensaji.dev",
  magicblockUrl: "https://magicblock.app",
  x402Url: "https://x402.org",
} as const;

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
