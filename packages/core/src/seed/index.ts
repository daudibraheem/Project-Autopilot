/**
 * Seeder for demo_target: a deterministic, offline Node repo with three planted problems.
 *   G1: tinydate 1.0.0 has a critical advisory; 2.0.0 renames parse → parseDate.
 *   G2: test/fx.test.js is flaky (FLAKY_SEED-controlled); --real-bug adds a genuine bug.
 *   G3: README setup block calls scripts/init.js, which was renamed; README has an injection line.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";
import { cleanGitEnv } from "../git";
import { generateCiHistory, toCsv } from "./ci-history";

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), "templates");
const AUTHOR = { GIT_AUTHOR_NAME: "Dana Dev", GIT_AUTHOR_EMAIL: "dana@example.com", GIT_COMMITTER_NAME: "Dana Dev", GIT_COMMITTER_EMAIL: "dana@example.com" };

function tpl(rel: string): string {
  return readFileSync(path.join(TEMPLATES, rel), "utf8");
}

function write(dir: string, rel: string, content: string) {
  const p = path.join(dir, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
}

async function commit(dir: string, message: string, date: string) {
  const git = simpleGit(dir).env(cleanGitEnv({ ...AUTHOR, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }));
  await git.add(["-A"]);
  await git.commit(message);
}

export function advisoriesJson(now = new Date()): string {
  const published = new Date(now.getTime() - 21 * 86400_000).toISOString();
  return `${JSON.stringify(
    {
      source: "local advisory database (demo)",
      advisories: [
        {
          id: "TINYDATE-2026-0001",
          package: "tinydate",
          severity: "critical",
          title: "Regular expression denial of service in tinydate.parse",
          vulnerableVersions: ["1.0.0"],
          fixedIn: "2.0.0",
          published,
          url: "https://example.invalid/advisories/TINYDATE-2026-0001",
        },
      ],
    },
    null,
    2,
  )}\n`;
}

export interface SeedOptions {
  force?: boolean;
  now?: Date;
}

/** Create demo_target from scratch. */
export async function seedDemoTarget(dir: string, opts: SeedOptions = {}): Promise<void> {
  if (existsSync(dir)) {
    if (!opts.force) throw new Error(`${dir} already exists (use --force to recreate)`);
    // Safety: only ever replace a previously seeded demo repo (or an empty dir), never a real project.
    const seeded = existsSync(path.join(dir, "advisories.json")) && existsSync(path.join(dir, "vendor", "tinydate-1.0.0"));
    if (!seeded && readdirSync(dir).length > 0) {
      throw new Error(`Refusing to overwrite ${dir}: it is not a seeded demo_target. Point TARGET_REPO_PATH at ./demo_target to seed.`);
    }
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });
  const git = simpleGit(dir);
  await git.init(["-b", "main"]);
  await git.addConfig("user.name", "Dana Dev");
  await git.addConfig("user.email", "dana@example.com");
  await git.addConfig("commit.gpgsign", "false");

  // Commit 1: the app, with the setup script still called scripts/init.js
  cpSync(path.join(TEMPLATES, "vendor"), path.join(dir, "vendor"), { recursive: true });
  for (const f of ["src/invoice.js", "src/due.js", "src/cli.js", "test/invoice.test.js", "test/due.test.js", "scripts/lint.js", "README.md"]) {
    write(dir, f, tpl(f));
  }
  write(dir, ".gitignore", tpl("gitignore"));
  write(dir, "scripts/init.js", tpl("scripts/bootstrap.js").replace(" Renamed from scripts/init.js in v1.3.0.", ""));
  write(dir, "package.json", tpl("package.json").replace("scripts/bootstrap.js", "scripts/init.js"));
  write(dir, "advisories.json", advisoriesJson(opts.now));
  await commit(dir, "Initial invoice calculator", "2026-09-01T10:00:00Z");

  // Commit 2: rename init.js → bootstrap.js (README not updated: G3)
  rmSync(path.join(dir, "scripts/init.js"));
  write(dir, "scripts/bootstrap.js", tpl("scripts/bootstrap.js"));
  write(dir, "package.json", tpl("package.json"));
  await commit(dir, "Rename setup script to scripts/bootstrap.js", "2026-09-20T14:30:00Z");

  // Commit 3: currency conversion via (simulated) rate service: flaky test (G2)
  write(dir, "src/fx.js", tpl("src/fx.js"));
  write(dir, "test/fx.test.js", tpl("test/fx.test.js"));
  write(dir, "ci_history.csv", toCsv(generateCiHistory()));
  await commit(dir, "Add EUR conversion via exchange-rate service", "2026-10-02T09:15:00Z");
}

/** --real-bug: a genuine regression in tax rounding (classifier should say "real"). */
export async function addRealBug(dir: string): Promise<string> {
  const p = path.join(dir, "src/invoice.js");
  const src = readFileSync(p, "utf8");
  if (src.includes("Math.floor(amount * 100)")) return "real bug already present";
  writeFileSync(p, src.replace("return Math.round(amount * 100) / 100;", "return Math.floor(amount * 100) / 100;"));
  await commit(dir, "Simplify cents rounding in invoice totals", new Date().toISOString());
  return "added commit 'Simplify cents rounding in invoice totals' (genuine bug)";
}

/** --reintroduce g1: put the vulnerable tinydate 1.0.0 back on main (used to show trust promotion). */
export async function reintroduceG1(dir: string): Promise<string> {
  const pkgPath = path.join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.dependencies.tinydate = "file:vendor/tinydate-1.0.0";
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  write(dir, "src/due.js", tpl("src/due.js"));
  await commit(dir, "Pin tinydate back to 1.0.0 (temporary workaround)", new Date().toISOString());
  return "re-introduced tinydate 1.0.0 on main";
}
