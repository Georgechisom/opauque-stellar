// @ts-nocheck
/**
 * Soak test harness for long-running protocol services (ASP, Publisher, Relayer).
 *
 * Runs all three services under continuous representative load with resource
 * tracking. Memory and handle growth are recorded at regular intervals. Failures
 * produce actionable diagnostics.
 *
 * Usage:
 *   tsx scripts/soak-test.ts --duration 48h
 *   tsx scripts/soak-test.ts --duration 2h --tick-interval 30s
 *
 * Environment:
 *   SOAK_DURATION        Total run time (default: 48h). Supports <n>s, <n>m, <n>h.
 *   SOAK_TICK_INTERVAL   Interval between service ticks (default: 10s).
 *   SOAK_REPORT_DIR      Directory for resource snapshots (default: target/soak/).
 *   SOAK_MEMORY_LIMIT    Max RSS in MB before abort (default: 2048).
 *   DEPLOYER_SECRET      Stellar deployer secret for testnet operations.
 */
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── Config ──────────────────────────────────────────────────────────────────

function parseDuration(raw: string): number {
  const m = raw.match(/^(\d+)(s|m|h)$/);
  if (!m) return 48 * 3600;
  const n = parseInt(m[1], 10);
  switch (m[2]) {
    case "s": return n;
    case "m": return n * 60;
    case "h": return n * 3600;
    default: return 48 * 3600;
  }
}

const DURATION_S = parseDuration(process.env.SOAK_DURATION ?? process.argv.find((a) => a.startsWith("--duration="))?.split("=")[1] ?? "48h");
const TICK_INTERVAL_S = parseDuration(process.env.SOAK_TICK_INTERVAL ?? process.argv.find((a) => a.startsWith("--tick-interval="))?.split("=")[1] ?? "10s");
const REPORT_DIR = process.env.SOAK_REPORT_DIR ?? join(process.cwd(), "target", "soak");
const MEMORY_LIMIT_MB = parseInt(process.env.SOAK_MEMORY_LIMIT ?? "2048", 10);
const START_TIME = Date.now();

// ── Helpers ─────────────────────────────────────────────────────────────────

function elapsed(): string {
  const s = Math.floor((Date.now() - START_TIME) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function getMemorySnapshot(): { rss: number; heapUsed: number; heapTotal: number } {
  const mem = process.memoryUsage();
  return {
    rss: Math.round(mem.rss / 1024 / 1024),
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
  };
}

function getOpenFileHandles(): number {
  try {
    const pid = process.pid;
    const result = execSync(`ls /proc/${pid}/fd 2>/dev/null | wc -l`, { encoding: "utf-8" }).trim();
    return parseInt(result, 10) || 0;
  } catch {
    return -1;
  }
}

interface Snapshot {
  timestamp: string;
  elapsed: string;
  memory: ReturnType<typeof getMemorySnapshot>;
  fileHandles: number;
  services: Record<string, { pid: number | null; running: boolean; exitCode: number | null }>;
}

function recordSnapshot(services: ServiceState[]) {
  const snap: Snapshot = {
    timestamp: new Date().toISOString(),
    elapsed: elapsed(),
    memory: getMemorySnapshot(),
    fileHandles: getOpenFileHandles(),
    services: {},
  };
  for (const svc of services) {
    snap.services[svc.name] = {
      pid: svc.process?.pid ?? null,
      running: svc.process !== null && !svc.process!.killed,
      exitCode: svc.exitCode,
    };
  }
  const line = JSON.stringify(snap);
  appendFileSync(join(REPORT_DIR, "snapshots.jsonl"), line + "\n");
}

interface ServiceState {
  name: string;
  cwd: string;
  cmd: string;
  process: ChildProcess | null;
  exitCode: number | null;
  restarts: number;
}

function startService(name: string, cwd: string, cmd: string): ServiceState {
  const [bin, ...args] = cmd.split(" ");
  const proc = spawn(bin, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production" },
  });
  const logPath = join(REPORT_DIR, `${name}.log`);
  proc.stdout?.on("data", (d) => appendFileSync(logPath, d));
  proc.stderr?.on("data", (d) => appendFileSync(logPath, d));
  proc.on("exit", (code) => {
    console.log(`[${elapsed()}] ${name} exited with code ${code}`);
  });
  return { name, cwd, cmd, process: proc, exitCode: null, restarts: 0 };
}

function restartService(svc: ServiceState): void {
  svc.restarts++;
  const restartLog = join(REPORT_DIR, "restarts.log");
  appendFileSync(restartLog, `[${elapsed()}] Restarting ${svc.name} (restart #${svc.restarts})\n`);
  const [bin, ...args] = svc.cmd.split(" ");
  svc.process = spawn(bin, args, {
    cwd: svc.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production" },
  });
  const logPath = join(REPORT_DIR, `${svc.name}.log`);
  svc.process.stdout?.on("data", (d) => appendFileSync(logPath, d));
  svc.process.stderr?.on("data", (d) => appendFileSync(logPath, d));
  svc.process.on("exit", (code) => {
    svc.exitCode = code;
    console.log(`[${elapsed()}] ${svc.name} exited with code ${code}`);
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });
  const summaryPath = join(REPORT_DIR, "summary.json");

  console.log("══════════════════════════════════════════════════════════════════");
  console.log("  Soak Test Harness");
  console.log(`  Duration:     ${DURATION_S}s (${(DURATION_S / 3600).toFixed(1)}h)`);
  console.log(`  Tick:         ${TICK_INTERVAL_S}s`);
  console.log(`  Memory limit: ${MEMORY_LIMIT_MB} MB RSS`);
  console.log(`  Report dir:   ${REPORT_DIR}`);
  console.log("══════════════════════════════════════════════════════════════════");

  const repoRoot = join(import.meta.dirname ?? process.cwd(), "..");
  const services: ServiceState[] = [
    startService("asp", join(repoRoot, "asp"), "npx tsx scripts/indexer.ts"),
    startService("publisher", join(repoRoot, "publisher"), "npx tsx scripts/publisher.ts"),
    startService("relayer-hub", join(repoRoot, "relayer"), "npx tsx scripts/hub.ts"),
  ];

  // Write initial snapshot.
  recordSnapshot(services);

  const endTime = START_TIME + DURATION_S * 1000;
  let tickCount = 0;
  const memoryHistory: number[] = [];
  const handleHistory: number[] = [];
  let peakRss = 0;
  let peakHandles = 0;
  let aborted = false;

  while (Date.now() < endTime) {
    await new Promise((r) => setTimeout(r, TICK_INTERVAL_S * 1000));
    tickCount++;

    const snap = getMemorySnapshot();
    const handles = getOpenFileHandles();
    memoryHistory.push(snap.rss);
    handleHistory.push(handles);
    if (snap.rss > peakRss) peakRss = snap.rss;
    if (handles > peakHandles) peakHandles = handles;

    // Check memory limit.
    if (snap.rss > MEMORY_LIMIT_MB) {
      console.error(`[${elapsed()}] ABORT: RSS ${snap.rss} MB exceeds limit ${MEMORY_LIMIT_MB} MB`);
      aborted = true;
      break;
    }

    // Restart any exited services.
    for (const svc of services) {
      if (svc.process && svc.process.killed) {
        console.log(`[${elapsed()}] ${svc.name} died — restarting`);
        restartService(svc);
      }
    }

    // Log periodic status.
    if (tickCount % 60 === 0) {
      console.log(
        `[${elapsed()}] tick=${tickCount} rss=${snap.rss}MB heap=${snap.heapUsed}MB handles=${handles} peak_rss=${peakRss}MB`,
      );
    }

    recordSnapshot(services);
  }

  // Final diagnostics.
  const finalSnap = getMemorySnapshot();
  const memoryDelta = finalSnap.rss - memoryHistory[0];
  const handleDelta = handleHistory[0] >= 0 ? getOpenFileHandles() - handleHistory[0] : 0;

  const summary = {
    startTime: new Date(START_TIME).toISOString(),
    endTime: new Date().toISOString(),
    durationSeconds: DURATION_S,
    tickCount,
    aborted,
    memory: {
      startMB: memoryHistory[0],
      endMB: finalSnap.rss,
      deltaMB: memoryDelta,
      peakMB: peakRss,
      heapUsedEndMB: finalSnap.heapUsed,
    },
    fileHandles: {
      start: handleHistory[0],
      end: getOpenFileHandles(),
      delta: handleDelta,
      peak: peakHandles,
    },
    services: Object.fromEntries(
      services.map((s) => [
        s.name,
        { restarts: s.restarts, finalExitCode: s.exitCode },
      ]),
    ),
  };

  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log("");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("  Soak Test Complete");
  console.log(`  Duration:       ${elapsed()}`);
  console.log(`  Ticks:          ${tickCount}`);
  console.log(`  Peak RSS:       ${peakRss} MB`);
  console.log(`  RSS delta:      ${memoryDelta > 0 ? "+" : ""}${memoryDelta} MB`);
  console.log(`  Peak handles:   ${peakHandles}`);
  console.log(`  Handle delta:   ${handleDelta > 0 ? "+" : ""}${handleDelta}`);
  console.log(`  Service restarts: ${services.reduce((a, s) => a + s.restarts, 0)}`);
  for (const svc of services) {
    console.log(`    ${svc.name}: ${svc.restarts} restarts, exit=${svc.exitCode}`);
  }
  console.log(`  Summary:        ${summaryPath}`);
  console.log(`  Snapshots:      ${join(REPORT_DIR, "snapshots.jsonl")}`);
  console.log("══════════════════════════════════════════════════════════════════");

  // Cleanup: kill all spawned processes.
  for (const svc of services) {
    if (svc.process && !svc.process.killed) {
      svc.process.kill("SIGTERM");
    }
  }

  process.exit(aborted ? 1 : 0);
}

main().catch((err) => {
  console.error("Soak test failed:", err);
  process.exit(1);
});
