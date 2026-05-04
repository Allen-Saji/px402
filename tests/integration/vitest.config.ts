import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Devnet round trips take 4-12s. Burst test fan-out can push past 60s.
    testTimeout: 120_000,
    hookTimeout: 240_000,
    // Strict serial execution across files: each file gets its own subprocess
    // and we run only one at a time. Without this, parallel servers compete
    // for MagicBlock REST API + base RPC bandwidth and fail on
    // "block height exceeded" or "max retries".
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    sequence: { concurrent: false },
    reporters: ["verbose"],
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".tmp/**"],
  },
});
