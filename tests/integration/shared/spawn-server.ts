/**
 * Boot a px402-demo-apis subprocess against devnet, parse the listening port
 * from stdout, return a handle with cleanup. Each test file gets its own
 * server on a free port to avoid cross-file interference.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import {
  PX402_API_URL,
  PX402_BASE_RPC_URL,
  PX402_CLUSTER,
  PX402_EPHEMERAL_RPC_URL,
  PX402_USDC_MINT,
  PX402_VALIDATOR,
} from "./constants.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const DEMO_APIS_DIR = join(REPO_ROOT, "apps", "demo-apis");

export interface ServerHandle {
  url: string;
  port: number;
  paymentAddress: string;
  serverSecret: string;
  /** Resolves when the next stdout line matching the predicate appears. */
  waitForLog: (predicate: RegExp, timeoutMs?: number) => Promise<string>;
  /** Send SIGTERM, wait for exit. */
  kill: () => Promise<void>;
  /** Cumulative server log captured so far. */
  getLog: () => string;
}

export interface SpawnServerOptions {
  /** Server's receiving wallet pubkey (base58). Required. */
  paymentAddress: string;
  /** HMAC secret. Defaults to a fresh random string per spawn. */
  serverSecret?: string;
  /** Override pricing (path -> micro-USDC integer string). */
  pricing?: Record<string, string>;
  /** Token TTL override in ms. */
  tokenTtlMs?: number;
  /** Subscriber poll interval override in ms. */
  pollIntervalMs?: number;
  /** Extra env vars to inject. */
  extraEnv?: Record<string, string>;
}

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      if (typeof addr === "object" && addr) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("failed to pick free port")));
      }
    });
    srv.on("error", reject);
  });
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function spawnServer(opts: SpawnServerOptions): Promise<ServerHandle> {
  const port = await pickFreePort();
  const serverSecret = opts.serverSecret ?? randomHex(32);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    PX402_PAYMENT_ADDRESS: opts.paymentAddress,
    PX402_MINT: PX402_USDC_MINT,
    PX402_API_URL,
    PX402_BASE_RPC_URL,
    PX402_EPHEMERAL_RPC_URL,
    PX402_VALIDATOR,
    PX402_CLUSTER,
    PX402_SERVER_SECRET: serverSecret,
    ...(opts.pricing
      ? Object.fromEntries(
          Object.entries(opts.pricing).map(([path, price]) => [
            `PX402_PRICE_${path.replace(/^\/api\//, "").toUpperCase()}`,
            price,
          ]),
        )
      : {}),
    ...(opts.tokenTtlMs !== undefined ? { PX402_TOKEN_TTL_MS: String(opts.tokenTtlMs) } : {}),
    ...(opts.pollIntervalMs !== undefined ? { PX402_POLL_INTERVAL_MS: String(opts.pollIntervalMs) } : {}),
    ...(opts.extraEnv ?? {}),
  };

  const child: ChildProcess = spawn("pnpm", ["start"], {
    cwd: DEMO_APIS_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  const watchers: Array<{ regex: RegExp; resolve: (line: string) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = [];

  function consume(data: Buffer | string): void {
    const text = typeof data === "string" ? data : data.toString("utf8");
    log += text;
    for (const line of text.split("\n")) {
      if (!line) continue;
      for (let i = watchers.length - 1; i >= 0; i--) {
        const w = watchers[i]!;
        if (w.regex.test(line)) {
          clearTimeout(w.timer);
          watchers.splice(i, 1);
          w.resolve(line);
        }
      }
    }
  }
  child.stdout?.on("data", consume);
  child.stderr?.on("data", consume);

  const exitPromise = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });

  const handle: ServerHandle = {
    url: `http://127.0.0.1:${port}`,
    port,
    paymentAddress: opts.paymentAddress,
    serverSecret,
    waitForLog(predicate, timeoutMs = 60_000) {
      // Already in log?
      for (const line of log.split("\n")) {
        if (predicate.test(line)) return Promise.resolve(line);
      }
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = watchers.findIndex((w) => w.regex === predicate);
          if (idx >= 0) watchers.splice(idx, 1);
          reject(new Error(`waitForLog timeout: ${predicate}`));
        }, timeoutMs);
        watchers.push({ regex: predicate, resolve, reject, timer });
      });
    },
    async kill() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await Promise.race([
        exitPromise,
        new Promise<void>((res) => setTimeout(res, 5000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
    getLog: () => log,
  };

  // Wait until the server is listening before returning.
  await handle.waitForLog(/listening on http/, 30_000).catch(async (err) => {
    await handle.kill();
    throw new Error(`server failed to start in 30s. log:\n${log}\n\nreason: ${err.message}`);
  });

  return handle;
}
