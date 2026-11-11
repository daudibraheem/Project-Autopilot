/**
 * The constitution (AGENTS.md), enforced in code.
 * Every tool call and git operation is checked here BEFORE it runs.
 * Pure functions: callers write denials to the audit log.
 */
import path from "node:path";

export interface PolicyDecision {
  allowed: boolean;
  rule?: string;
  reason?: string;
}

const ALLOW: PolicyDecision = { allowed: true };
const deny = (rule: string, reason: string): PolicyDecision => ({ allowed: false, rule, reason });

/** High-risk paths: always need a human, at any trust level. Always added to forbiddenPaths. */
export const HIGH_RISK_PATTERNS = [
  ".github/**",
  "**/*.yml",
  "**/*.yaml",
  "AGENTS.md",
  "**/AGENTS.md",
  "CLAUDE.md",
  "**/CLAUDE.md",
  "prompts/**",
  "**/mcp*.json",
  "infra/**",
] as const;

/** Minimal glob → RegExp: supports `**`, `*`, `?`. Paths are POSIX, repo-relative. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // "**/" matches zero or more directories
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(p: string, patterns: readonly string[]): boolean {
  return patterns.some((g) => globToRegExp(g).test(p));
}

/** Normalise a model/tool-supplied path. Returns null when it escapes the workspace. */
export function normalizeRepoPath(p: string): string | null {
  if (typeof p !== "string" || p.includes("\0")) return null;
  const cleaned = p.replace(/\\/g, "/").trim();
  if (cleaned === "" || cleaned === "." || cleaned === "./") return ".";
  if (path.posix.isAbsolute(cleaned)) return null;
  const norm = path.posix.normalize(cleaned).replace(/\/+$/, "");
  if (norm === ".." || norm.startsWith("../")) return null;
  return norm;
}

export function isHighRisk(p: string): boolean {
  const n = normalizeRepoPath(p);
  return n === null || matchesAny(n, HIGH_RISK_PATTERNS);
}

export interface PathScope {
  allowedPaths: string[];
  forbiddenPaths: string[];
}

/**
 * Rule 2 + 3: reads/writes only inside allowedPaths; never forbidden / high-risk paths.
 * `list` access to a directory is allowed when some allowed path lives under it.
 */
export function checkPathAccess(
  scope: PathScope,
  rawPath: string,
  mode: "read" | "write" | "list",
): PolicyDecision {
  const p = normalizeRepoPath(rawPath);
  if (p === null) return deny("outside-workspace", `Path "${rawPath}" escapes the workspace`);
  if (p.split("/").includes(".git")) return deny("git-internals", "Direct access to .git is not allowed");

  const forbidden = [...scope.forbiddenPaths, ...HIGH_RISK_PATTERNS];
  if (p !== "." && matchesAny(p, forbidden)) {
    const hr = matchesAny(p, HIGH_RISK_PATTERNS);
    return deny(
      hr ? "high-risk-path" : "forbidden-path",
      `"${p}" is ${hr ? "a high-risk path (always needs a human)" : "forbidden by the contract"}`,
    );
  }
  if (mode === "list") {
    const ok =
      p === "." ||
      matchesAny(p, scope.allowedPaths) ||
      scope.allowedPaths.some((g) => g.startsWith(`${p}/`) || globToRegExp(g).test(`${p}/x`));
    return ok ? ALLOW : deny("outside-allowed-paths", `"${p}" is outside the contract's allowedPaths`);
  }
  if (!matchesAny(p, scope.allowedPaths)) {
    return deny("outside-allowed-paths", `"${p}" is outside the contract's allowedPaths (${scope.allowedPaths.join(", ")})`);
  }
  return ALLOW;
}

/** Rule 1: AI may only touch autopilot/* refs. */
export function checkGitRef(ref: string): PolicyDecision {
  const r = ref.replace(/^refs\/heads\//, "").replace(/^origin\//, "");
  if (/^autopilot\/[A-Za-z0-9._-]+$/.test(r)) return ALLOW;
  return deny("write-to-protected-branch", `Writing to "${r}" is forbidden; agents may only write to autopilot/* branches`);
}

/** run_command allow-list. Anything else (git, curl, rm, shells, pipes) is denied. */
export const COMMAND_ALLOW_LIST: { pattern: RegExp; label: string; network?: boolean }[] = [
  { pattern: /^npm (install|ci) --offline( --no-audit| --no-fund| --no-package-lock)*$/, label: "npm install --offline" },
  { pattern: /^npm install( --no-audit| --no-fund| --no-package-lock)*$/, label: "npm install (registry)", network: true },
  { pattern: /^npm test$/, label: "npm test" },
  { pattern: /^npm run lint$/, label: "npm run lint (linter)" },
  { pattern: /^node --test( --test-reporter=(tap|spec))?( [\w./-]+\.test\.js)*$/, label: "node --test" },
];

export function checkCommand(cmd: string, opts: { allowRegistry: boolean }): PolicyDecision {
  const c = cmd.trim().replace(/\s+/g, " ");
  if (/[;&|`$<>]/.test(c)) return deny("command-not-allowed", "Shell operators are not allowed");
  if (/^git\b/.test(c)) {
    const target = /\bmain\b|\bmaster\b/.test(c) ? "main" : "git";
    return deny(
      target === "main" ? "write-to-protected-branch" : "command-not-allowed",
      target === "main"
        ? "Agents may never write to main (git commands are not available to agents)"
        : "git is not available to agents; the harness manages branches",
    );
  }
  const hit = COMMAND_ALLOW_LIST.find((a) => a.pattern.test(c));
  if (!hit) return deny("command-not-allowed", `"${c}" is not on the allow-list`);
  if (hit.network && !opts.allowRegistry) return deny("network-not-allowed", "The contract does not allow registry access");
  return ALLOW;
}

/** package.json `scripts` section is high-risk: any change needs a human. */
export function checkPackageJsonScripts(before: string, after: string): PolicyDecision {
  try {
    const a = JSON.stringify(JSON.parse(before).scripts ?? {});
    const b = JSON.stringify(JSON.parse(after).scripts ?? {});
    return a === b ? ALLOW : deny("high-risk-path", "The package.json scripts section is high-risk and cannot be changed by agents");
  } catch {
    return deny("invalid-json", "package.json is not valid JSON");
  }
}

/** Dependencies declared in a package.json text. */
export function readDependencies(pkgJson: string): Record<string, string> {
  try {
    const j = JSON.parse(pkgJson);
    return { ...(j.dependencies ?? {}), ...(j.devDependencies ?? {}), ...(j.optionalDependencies ?? {}) };
  } catch {
    return {};
  }
}

/**
 * Rule 4 (slopsquatting): every NEW or CHANGED dependency must exist in the package source.
 * `exists(name, spec)` is the source: vendor dir in demo mode, npm registry in real mode.
 */
export async function checkDependencies(
  before: string,
  after: string,
  exists: (name: string, spec: string) => Promise<boolean>,
): Promise<PolicyDecision> {
  const a = readDependencies(before);
  const b = readDependencies(after);
  for (const [name, spec] of Object.entries(b)) {
    if (a[name] === spec) continue;
    if (!(await exists(name, spec))) {
      return deny("unknown-dependency", `Dependency ${name}@${spec} does not exist in the package source`);
    }
  }
  return ALLOW;
}

/** Changed paths of a diff that violate scope (used by the gate as well as the policy). */
export function pathViolations(scope: PathScope, changed: string[]): { path: string; reason: string }[] {
  const out: { path: string; reason: string }[] = [];
  for (const p of changed) {
    const d = checkPathAccess(scope, p, "write");
    if (!d.allowed) out.push({ path: p, reason: d.reason ?? "denied" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Team data rules (Scrum Mode) — AGENTS.md rules 8–13
// ---------------------------------------------------------------------------

/** Hard trust caps per job type. Code-only: no setting can raise these (AGENTS.md rule 10). */
export const HARD_TRUST_CAPS: Readonly<Record<string, number>> = Object.freeze({ "nudge-draft": 0 });

export function trustCap(jobType: string, defaultMax = 2): number {
  return Object.hasOwn(HARD_TRUST_CAPS, jobType) ? Math.min(HARD_TRUST_CAPS[jobType]!, defaultMax) : defaultMax;
}

/** Rule 11: the Jira client is read-only. */
export function checkHttpMethod(method: string): PolicyDecision {
  return method.toUpperCase() === "GET" ? ALLOW : deny("read-only-integration", `Only GET requests are allowed to Jira (got ${method.toUpperCase()})`);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Name tokens to look for: full names plus each part with ≥ 3 letters. */
export function nameTokens(realNames: string[]): string[] {
  const out = new Set<string>();
  for (const n of realNames) {
    const full = n.trim();
    if (full.length >= 3) out.add(full);
    for (const part of full.split(/\s+/)) if (part.length >= 3) out.add(part);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** Rule 9: no real name may appear in text sent to (or returned by) a model. */
export function checkNoRealNames(text: string, realNames: string[]): PolicyDecision & { found?: string[] } {
  const found = nameTokens(realNames).filter((t) => new RegExp(`(^|[^\\p{L}])${esc(t)}($|[^\\p{L}])`, "iu").test(text));
  return found.length ? { ...deny("real-name-leak", `Real name(s) found: ${found.length} match(es)`), found } : ALLOW;
}

/** Built-in people-judgement patterns (rule 8). Extended at runtime by the `team.forbiddenTerms` setting. */
export const PEOPLE_JUDGEMENT_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "judgement", re: /\b(lazy|slow(er|est)?|underperform\w*|incompetent|careless|sloppy|unreliable|unproductive|useless|weak link|not pulling (their|his|her) weight|holding (everyone|the team|us) back)\b/i },
  { kind: "ranking", re: /\b(best|worst|fastest|slowest|top|bottom|most|least)\s+(\w+\s+)?(developer|engineer|member|person|performer|contributor|teammate)s?\b/i },
  { kind: "ranking", re: /\b(member [a-z])\b[^.]*\b(than|compared (to|with)|ahead of|behind)\b[^.]*\bmember [a-z]\b/i },
  { kind: "mood", re: /\b(frustrated|unhappy|stressed|angry|upset|burn(ed|t)[ -]out|demotivated|disengaged|annoyed|moody)\b/i },
  { kind: "personal-reason", re: /\b(sick|illness|personal (issues|problems|reasons|life)|family (issues|problems)|distracted|on holiday|hungover|probably (busy|away|off))\b/i },
  { kind: "speculation", re: /\b(probably|maybe|perhaps|likely|must be)\b[^.]*\b(because|due to)\b[^.]*\b(they|he|she|member [a-z])\b/i },
  { kind: "blame", re: /\b(fault|to blame|blame[sd]?|dropped the ball|let (the team|us) down)\b/i },
];

export function checkPeopleJudgement(text: string, extraTerms: string[] = []): PolicyDecision & { hits?: { kind: string; match: string }[] } {
  const hits: { kind: string; match: string }[] = [];
  for (const p of PEOPLE_JUDGEMENT_PATTERNS) {
    const m = p.re.exec(text);
    if (m) hits.push({ kind: p.kind, match: m[0] });
  }
  for (const t of extraTerms.filter((x) => x.trim())) {
    const m = new RegExp(`\\b${esc(t.trim())}\\b`, "i").exec(text);
    if (m) hits.push({ kind: "configured-term", match: m[0] });
  }
  return hits.length ? { ...deny("people-judgement", `Judgement of people: ${hits.map((h) => `${h.kind} "${h.match}"`).join(", ")}`), hits } : ALLOW;
}
