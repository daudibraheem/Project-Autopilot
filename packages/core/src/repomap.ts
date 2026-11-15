/**
 * Codebase map (repo_map tool): a simple graph of files, their exports, their imports, and the
 * call sites of a given symbol. A careful line parser for CommonJS/ESM JavaScript — no code is executed.
 * G1 uses it to find every call site of a renamed export (e.g. `parse`) before fixing them.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface ImportRef {
  module: string;
  symbols: string[];
  resolved?: string; // repo-relative path, for relative imports that resolve to a known file
  line: number;
}
export interface RepoMapFile {
  path: string;
  exports: string[];
  imports: ImportRef[];
}
export interface CallSite {
  symbol: string;
  path: string;
  line: number;
  text: string;
}
export interface RepoMap {
  symbol?: string;
  files: RepoMapFile[];
  edges: { from: string; to: string }[];
  callSites: CallSite[];
}

const CODE_DIRS = ["src", "test", "scripts"];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function namesInBraces(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim().split(":")[0]!.trim().replace(/\s*=.*$/, ""))
    .filter((x) => /^\w+$/.test(x));
}

/** Parse one module's exports and imports (no execution). */
export function parseModule(filePath: string, content: string): RepoMapFile {
  const lines = content.split("\n");
  const exports = new Set<string>();
  const imports: ImportRef[] = [];
  lines.forEach((line, i) => {
    const me = /module\.exports\s*=\s*\{([^}]*)\}/.exec(line);
    if (me) for (const n of namesInBraces(me[1]!)) exports.add(n);
    const named = /(?:module\.)?exports\.(\w+)\s*=/.exec(line);
    if (named) exports.add(named[1]!);
    for (const m of ["function", "const", "let"]) {
      const re = new RegExp(`module\\.exports\\s*=\\s*${m}\\s+(\\w+)`);
      const x = re.exec(line);
      if (x) exports.add(x[1]!);
    }
    const req = /require\(\s*['"]([^'"]+)['"]\s*\)/.exec(line);
    const esm = /import\s+(?:\{([^}]*)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/.exec(line);
    if (req) {
      const destr = /\{([^}]*)\}\s*=\s*require/.exec(line);
      imports.push({ module: req[1]!, symbols: destr ? namesInBraces(destr[1]!) : [], line: i + 1 });
    } else if (esm) {
      imports.push({ module: esm[3]!, symbols: esm[1] ? namesInBraces(esm[1]) : esm[2] ? [esm[2]] : [], line: i + 1 });
    }
  });
  return { path: filePath, exports: [...exports], imports };
}

/** Resolve a relative import to a repo-relative file path, if it matches one in the set. */
function resolveRelative(from: string, mod: string, known: Set<string>): string | undefined {
  if (!mod.startsWith(".")) return undefined;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), mod));
  for (const cand of [base, `${base}.js`, `${base}.mjs`, `${base}/index.js`]) {
    if (known.has(cand)) return cand;
  }
  return undefined;
}

/** Every call site of `symbol` across the files (call expressions, not the import or its definition). */
export function findCallSites(files: { path: string; content: string }[], symbol: string): CallSite[] {
  const re = new RegExp(`\\b${esc(symbol)}\\s*\\(`);
  const out: CallSite[] = [];
  for (const f of files) {
    f.content.split("\n").forEach((line, i) => {
      if (/\brequire\(|^\s*(import|\/\/|\*)/.test(line)) return; // skip imports and comments
      if (re.test(line) && !new RegExp(`function\\s+${esc(symbol)}\\s*\\(`).test(line)) {
        out.push({ symbol, path: f.path, line: i + 1, text: line.trim().slice(0, 160) });
      }
    });
  }
  return out;
}

export function buildRepoMap(files: { path: string; content: string }[], opts: { symbol?: string } = {}): RepoMap {
  const parsed = files.map((f) => parseModule(f.path, f.content));
  const known = new Set(files.map((f) => f.path));
  const edges: { from: string; to: string }[] = [];
  for (const f of parsed) {
    for (const imp of f.imports) {
      imp.resolved = resolveRelative(f.path, imp.module, known);
      if (imp.resolved) edges.push({ from: f.path, to: imp.resolved });
    }
  }
  return { symbol: opts.symbol, files: parsed, edges, callSites: opts.symbol ? findCallSites(files, opts.symbol) : [] };
}

/** List repo-relative JS files under the code directories of a workspace (no vendor/node_modules/.git). */
export function listCodeFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "vendor") continue;
      const childRel = path.posix.join(rel, e.name);
      if (e.isDirectory()) walk(childRel);
      else if (/\.(c|m)?js$/.test(e.name)) out.push(childRel);
    }
  };
  for (const d of CODE_DIRS) {
    const abs = path.join(root, d);
    if (existsSync(abs) && statSync(abs).isDirectory()) walk(d);
  }
  return out.sort();
}

/** A compact text rendering of the map for the model (wrapped as untrusted by the tool). */
export function renderMapText(map: RepoMap): string {
  const lines: string[] = [];
  for (const f of map.files) {
    const imps = f.imports.map((i) => i.module).join(", ");
    lines.push(`${f.path} — exports: ${f.exports.join(", ") || "(none)"}${imps ? ` · imports: ${imps}` : ""}`);
  }
  if (map.symbol) {
    lines.push("", `Call sites of ${map.symbol}:`);
    if (map.callSites.length === 0) lines.push("  (none)");
    for (const c of map.callSites) lines.push(`  ${c.path}:${c.line}: ${c.text}`);
  }
  return lines.join("\n");
}
