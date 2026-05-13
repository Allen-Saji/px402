/**
 * px402 subscriber soak harness.
 *
 * Boots a PrivateTransferSubscriber against live MagicBlock devnet, lets it
 * run for `--duration` minutes, samples process memory + subscriber state
 * every `--interval` seconds, and writes a CSV. On exit prints a summary
 * including the linear-regression slope of RSS vs time so leaks are obvious.
 *
 * No payments are made — this isolates subscriber-side leak detection from
 * payment-flow leaks (the payment flow is exercised by integration tests).
 * Devnet fee burn: zero.
 *
 * Usage:
 *   pnpm --filter px402-scripts soak -- --duration 60
 *   pnpm --filter px402-scripts soak -- --duration 5 --interval 10  (quick smoke)
 *   pnpm --filter px402-scripts soak -- --csv /tmp/px402-soak.csv
 */
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Repo root = parent of scripts/. Used to make --csv paths cwd-independent.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
import { PrivateTransferSubscriber, deriveQueuePda } from "@px402/core";
import {
  PX402_EPHEMERAL_RPC_URL,
  PX402_USDC_MINT,
  PX402_VALIDATOR,
  TMP_DIR,
} from "../tests/integration/shared/constants.js";
import { ensureServerKeypair } from "../tests/integration/shared/server-keypair.js";

interface CliArgs {
  durationMin: number;
  intervalSec: number;
  csvPath: string;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {
    durationMin: 60,
    intervalSec: 60,
    csvPath: join(TMP_DIR, "soak.csv"),
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--duration") args.durationMin = Number(argv[++i]);
    else if (a === "--interval") args.intervalSec = Number(argv[++i]);
    else if (a === "--csv") {
      const raw = argv[++i];
      // Resolve relative paths against the repo root so --csv doesn't depend
      // on the caller's cwd (pnpm runs scripts from packages/scripts/).
      args.csvPath = raw ? (isAbsolute(raw) ? raw : resolve(REPO_ROOT, raw)) : args.csvPath;
    } else if (a === "--help" || a === "-h") {
      console.log("Usage: pnpm soak -- [--duration MIN] [--interval SEC] [--csv PATH]");
      process.exit(0);
    }
  }
  if (!Number.isFinite(args.durationMin) || args.durationMin <= 0) {
    throw new Error("--duration must be a positive number of minutes");
  }
  if (!Number.isFinite(args.intervalSec) || args.intervalSec < 5) {
    throw new Error("--interval must be at least 5 seconds");
  }
  return args;
}

interface Sample {
  t: number; // seconds since start
  rssMb: number;
  heapUsedMb: number;
  externalMb: number;
  indexed: number;
  queued: number;
  orphans: number;
  usedSigs: number;
  pollsSinceLastSample: number;
  errorsSinceLastSample: number;
}

function snapshot(
  startMs: number,
  subscriber: PrivateTransferSubscriber,
  pollsThisInterval: number,
  errorsThisInterval: number,
): Sample {
  const mem = process.memoryUsage();
  const status = subscriber.getStatus();
  return {
    t: Math.round((Date.now() - startMs) / 1000),
    rssMb: round(mem.rss / 1024 / 1024),
    heapUsedMb: round(mem.heapUsed / 1024 / 1024),
    externalMb: round(mem.external / 1024 / 1024),
    indexed: status.indexedCount,
    queued: status.queuedCount,
    orphans: status.orphanCount,
    usedSigs: status.usedSigCount,
    pollsSinceLastSample: pollsThisInterval,
    errorsSinceLastSample: errorsThisInterval,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function csvRow(s: Sample): string {
  return [
    s.t,
    s.rssMb,
    s.heapUsedMb,
    s.externalMb,
    s.indexed,
    s.queued,
    s.orphans,
    s.usedSigs,
    s.pollsSinceLastSample,
    s.errorsSinceLastSample,
  ].join(",");
}

const CSV_HEADER =
  "t_sec,rss_mb,heap_used_mb,external_mb,indexed,queued,orphans,used_sigs,polls,errors";

/**
 * Linear least-squares slope of RSS vs time, in MB/hour. Drops the first
 * sample (startup memory peak before first GC settles) so warmup doesn't
 * contaminate the leak signal.
 */
function slopeMbPerHour(samples: Sample[]): number {
  const useable = samples.slice(1);
  if (useable.length < 2) return 0;
  const n = useable.length;
  const xs = useable.map((s) => s.t / 3600);
  const ys = useable.map((s) => s.rssMb);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - xMean) * (ys[i]! - yMean);
    den += (xs[i]! - xMean) ** 2;
  }
  return den === 0 ? 0 : round(num / den);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const serverKp = ensureServerKeypair();
  const queuePda = deriveQueuePda(PX402_USDC_MINT, PX402_VALIDATOR).toBase58();

  console.log("[soak] config:");
  console.log(`  queuePda    : ${queuePda}`);
  console.log(`  receiver    : ${serverKp.publicKey.toBase58()}`);
  console.log(`  rpc         : ${PX402_EPHEMERAL_RPC_URL}`);
  console.log(`  duration    : ${args.durationMin} min`);
  console.log(`  sample every: ${args.intervalSec} sec`);
  console.log(`  csv         : ${args.csvPath}`);
  console.log();

  if (!existsSync(dirname(args.csvPath))) {
    mkdirSync(dirname(args.csvPath), { recursive: true });
  }
  writeFileSync(args.csvPath, CSV_HEADER + "\n");

  let pollsTotal = 0;
  let pollsInInterval = 0;
  let errorsInInterval = 0;
  const errorMessages: string[] = [];

  const subscriber = new PrivateTransferSubscriber({
    rpcUrl: PX402_EPHEMERAL_RPC_URL,
    queuePda,
    receiverWallet: serverKp.publicKey.toBase58(),
    pollIntervalMs: 500,
    logger: {
      info: (m) => {
        if (m.includes("poll:")) {
          pollsTotal++;
          pollsInInterval++;
        }
      },
      warn: () => {},
      error: () => {},
    },
  });
  subscriber.on("error", (e) => {
    errorsInInterval++;
    if (errorMessages.length < 20) errorMessages.push(e.message);
  });
  subscriber.on("stalled", () => {
    console.warn("[soak] STALLED event fired");
  });

  await subscriber.start();
  console.log("[soak] subscriber started, sampling begins");

  const samples: Sample[] = [];
  const startMs = Date.now();
  const deadlineMs = startMs + args.durationMin * 60 * 1000;
  const initial = snapshot(startMs, subscriber, 0, 0);
  samples.push(initial);
  appendFileSync(args.csvPath, csvRow(initial) + "\n");
  console.log(`[soak] t=0s rss=${initial.rssMb}MB heap=${initial.heapUsedMb}MB`);

  let stopped = false;
  const onSignal = () => {
    if (stopped) return;
    stopped = true;
    console.log("\n[soak] received signal, stopping subscriber");
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  while (!stopped && Date.now() < deadlineMs) {
    await new Promise((r) => setTimeout(r, args.intervalSec * 1000));
    const s = snapshot(startMs, subscriber, pollsInInterval, errorsInInterval);
    pollsInInterval = 0;
    errorsInInterval = 0;
    samples.push(s);
    appendFileSync(args.csvPath, csvRow(s) + "\n");
    console.log(
      `[soak] t=${s.t}s rss=${s.rssMb}MB heap=${s.heapUsedMb}MB indexed=${s.indexed} polls=${s.pollsSinceLastSample} errs=${s.errorsSinceLastSample}`,
    );
  }

  await subscriber.stop();

  // Summary
  const rssVals = samples.map((s) => s.rssMb);
  const heapVals = samples.map((s) => s.heapUsedMb);
  const minRss = Math.min(...rssVals);
  const maxRss = Math.max(...rssVals);
  const minHeap = Math.min(...heapVals);
  const maxHeap = Math.max(...heapVals);
  const slope = slopeMbPerHour(samples);

  console.log();
  console.log("[soak] summary");
  console.log(`  samples     : ${samples.length}`);
  console.log(`  duration    : ${samples[samples.length - 1]!.t}s`);
  console.log(`  polls total : ${pollsTotal}`);
  console.log(`  rss min/max : ${minRss}MB / ${maxRss}MB (delta ${round(maxRss - minRss)}MB)`);
  console.log(`  heap min/max: ${minHeap}MB / ${maxHeap}MB (delta ${round(maxHeap - minHeap)}MB)`);
  console.log(`  rss slope   : ${slope}MB/hr ${Math.abs(slope) < 5 ? "[OK]" : "[INVESTIGATE]"}`);
  if (errorMessages.length > 0) {
    console.log(`  first errors: ${errorMessages.slice(0, 5).join(" | ")}`);
  }
  console.log(`  csv         : ${args.csvPath}`);
}

main().catch((err) => {
  console.error("[soak] fatal:", err);
  process.exit(1);
});
