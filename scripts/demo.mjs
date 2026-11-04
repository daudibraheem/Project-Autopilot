#!/usr/bin/env node
/**
 * pnpm demo — one command, clean state, no API key, no internet (mock mode).
 *   1. docker compose up -d db          5. seed demo_target
 *   2. prisma generate + migrations      6. train the flaky classifier
 *   3. reset the database                7. check goals (all three start red)
 *   4. seed settings                     8. start web + worker (concurrently) and print the demo steps
 * `pnpm demo:prepare` does 1–7 only.
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prepareOnly = process.argv.includes("--prepare-only");
const c = { dim: "\x1b[2m", bold: "\x1b[1m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", reset: "\x1b[0m" };

function step(title) {
  console.log(`\n${c.bold}▸ ${title}${c.reset}`);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: opts.quiet ? "pipe" : "inherit", encoding: "utf8", env: { ...process.env, ...(opts.env ?? {}) } });
  if (r.status !== 0 && !opts.allowFail) {
    if (opts.quiet) console.error(r.stdout, r.stderr);
    console.error(`${c.red}✗ ${cmd} ${args.join(" ")} failed${c.reset}`);
    process.exit(r.status ?? 1);
  }
  return r;
}

/** A variable from .env (without loading it into process.env). */
function readEnvVar(name) {
  try {
    const line = readFileSync(path.join(ROOT, ".env"), "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).split("#")[0].trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Database name from DATABASE_URL (env, else .env), default "autopilot". */
function dbName() {
  let url = process.env.DATABASE_URL;
  if (!url) {
    try {
      process.loadEnvFile(path.join(ROOT, ".env"));
      url = process.env.DATABASE_URL;
    } catch {}
  }
  try {
    return new URL(url).pathname.replace(/^\//, "") || "autopilot";
  } catch {
    return "autopilot";
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// 0. .env
if (!existsSync(path.join(ROOT, ".env"))) {
  copyFileSync(path.join(ROOT, ".env.example"), path.join(ROOT, ".env"));
  console.log(`${c.dim}Created .env from .env.example (mock mode, no keys).${c.reset}`);
}

step("1/7 Starting PostgreSQL 16 (docker compose up -d db)");
{
  // If our container isn't running yet, make sure its host port is free and explain how to fix it if not.
  const port = Number(process.env.AUTOPILOT_DB_PORT || readEnvVar("AUTOPILOT_DB_PORT") || 5432);
  const running = run("docker", ["compose", "ps", "-q", "--status", "running", "db"], { quiet: true, allowFail: true }).stdout?.trim();
  if (!running) {
    const probe = spawnSync(process.execPath, ["-e", `require("net").createServer().once("error",()=>process.exit(1)).listen(${port},"0.0.0.0",function(){this.close(()=>process.exit(0))})`]);
    if (probe.status !== 0) {
      console.error(`${c.red}✗ Port ${port} is already in use on this machine, so Postgres can't start there.${c.reset}`);
      console.error(`  Fix: in .env set AUTOPILOT_DB_PORT to a free port (e.g. 5434) and use the same port in DATABASE_URL:`);
      console.error(`    AUTOPILOT_DB_PORT=5434`);
      console.error(`    DATABASE_URL=postgresql://autopilot:autopilot@localhost:5434/autopilot`);
      process.exit(1);
    }
  }
}
run("docker", ["compose", "up", "-d", "db"]);
let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  ready = run("docker", ["compose", "exec", "-T", "db", "pg_isready", "-U", "autopilot", "-d", "autopilot"], { quiet: true, allowFail: true }).status === 0;
  if (!ready) sleep(1000);
}
if (!ready) {
  console.error(`${c.red}Postgres did not become ready.${c.reset}`);
  process.exit(1);
}
console.log(`${c.green}✓ database ready${c.reset}`);

const img = run("docker", ["image", "inspect", "node:22-slim"], { quiet: true, allowFail: true });
if (img.status !== 0) {
  console.log(`${c.dim}Pulling sandbox image node:22-slim (one-time)…${c.reset}`);
  const pull = run("docker", ["pull", "node:22-slim"], { allowFail: true });
  if (pull.status !== 0) console.log(`${c.yellow}⚠ Could not pull node:22-slim. Sandbox falls back to the local runner (UNSAFE: no container).${c.reset}`);
}

step("2/7 Prisma generate + migrations");
run("pnpm", ["--filter", "@autopilot/db", "generate"], { quiet: true });
run("pnpm", ["--filter", "@autopilot/db", "migrate:deploy"]);

step("3/7 Resetting the database (Autopilot tables + job queue only)");
// Empties only this app's own tables in the local docker-compose database (see DECISIONS #24).
const TABLES = ["GoalCheck", "Job", "Contract", "JobStep", "VerifierReport", "GateResult", "ApprovalDecision", "TrustRecord", "TrustEvent", "Lesson", "AuditEvent", "Setting", "MlModel", "MlPrediction"];
const resetSql = `DROP SCHEMA IF EXISTS pgboss CASCADE; TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} CASCADE;`;
run("docker", ["compose", "exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", "-U", "autopilot", "-d", dbName(), "-qc", resetSql], { quiet: true });
rmSync(path.join(ROOT, ".autopilot"), { recursive: true, force: true });
mkdirSync(path.join(ROOT, "memory"), { recursive: true });
writeFileSync(path.join(ROOT, "memory", "lessons.md"), "# Autopilot lessons\n\nWritten automatically after every job. Loaded into the next job of the same type.\n\n");
run("pnpm", ["--filter", "@autopilot/db", "seed"], { quiet: true });
console.log(`${c.green}✓ clean database, settings seeded, workspaces and lessons cleared${c.reset}`);

step("4/7 Seeding demo_target (3 planted problems)");
run("pnpm", ["cli", "seed"]);

step("5/7 Training the flaky-test classifier");
run("pnpm", ["cli", "train"]);

step("6/7 Checking standing goals on main");
run("pnpm", ["cli", "check"]);

const STEPS = `
${c.bold}Project Autopilot is ready.${c.reset}  Open ${c.bold}http://localhost:3000${c.reset}   (full script: docs/DEMO_SCRIPT.md)

  1. Overview: G1, G2 and G3 are red.
  2. G1 → "Run job". Watch the job page: bump tinydate, tests fail, fix the renamed call site,
     tests pass, verifier passes, gate all green. Approvals → "Approve and merge". G1 turns green.
  3. G2 → "Run job". Classifier says flaky, the re-run passes, a quarantine is proposed. Approve it.
     Then in a terminal:  ${c.bold}pnpm cli seed --real-bug${c.reset}  → "Check goals now" → G2 "Run job".
     Classifier says real bug, cause commit found, fix proposed. Approve.
  4. G3 → "Run job". README step fixed; the injection line is ignored. Audit log → "Policy denials only"
     shows the blocked "git push origin main".
  5. Terminal:  ${c.bold}pnpm cli demo-bad-worker${c.reset}  → policy, verifier and gate all block it.
  6. Trust ledger, Lessons and per-job cost. For a promotion:  ${c.bold}pnpm cli seed --reintroduce g1${c.reset}
     → "Check goals now" → G1 "Run job" → approve; repeat once more → L0 → L1.
  7. Flip the kill switch. "Run job" is refused.
`;

if (prepareOnly) {
  console.log(STEPS);
  process.exit(0);
}

step("7/7 Starting web (http://localhost:3000) + worker");
console.log(STEPS);
const child = spawn("pnpm", ["dev"], { cwd: ROOT, stdio: "inherit" });
const stop = () => child.kill("SIGINT");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
