/**
 * Package + advisory sources.
 *   Demo mode: vendor/ dir + local advisories.json (offline).
 *   Real mode: npm registry + OSV API.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export interface Advisory {
  id: string;
  package: string;
  severity: "low" | "moderate" | "high" | "critical";
  title: string;
  vulnerableVersions: string[];
  fixedIn: string | null;
  published: string;
  url?: string;
}

/** Versions of a package available in vendor/ (dirs named <name>-<version>). */
export function vendorVersions(root: string, name: string): string[] {
  const dir = path.join(root, "vendor");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => d.startsWith(`${name}-`) && existsSync(path.join(dir, d, "package.json")))
    .map((d) => JSON.parse(readFileSync(path.join(dir, d, "package.json"), "utf8")).version as string)
    .sort();
}

/** Does name@spec exist in the vendor dir? spec is "file:vendor/<dir>" or an exact version. */
export function existsInVendor(root: string, name: string, spec: string): boolean {
  if (spec.startsWith("file:")) {
    const rel = spec.slice(5);
    if (!/^vendor\/[\w.@-]+$/.test(rel)) return false;
    const pj = path.join(root, rel, "package.json");
    if (!existsSync(pj)) return false;
    try {
      return JSON.parse(readFileSync(pj, "utf8")).name === name;
    } catch {
      return false;
    }
  }
  return vendorVersions(root, name).includes(spec.replace(/^[\^~=]/, ""));
}

/** Real mode: does the package (and exact version, if pinned) exist on the npm registry? */
export async function existsOnNpm(name: string, spec: string): Promise<boolean> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name).replace("%40", "@")}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { versions?: Record<string, unknown> };
    const exact = /^\d+\.\d+\.\d+/.exec(spec.replace(/^[=]/, ""));
    return exact ? Boolean(body.versions?.[exact[0]]) : true;
  } catch {
    return false;
  }
}

/** Resolve the installed version of a dependency spec (demo: file:vendor/x; real: node_modules). */
export function installedVersion(root: string, name: string, spec: string): string | null {
  if (spec.startsWith("file:")) {
    const pj = path.join(root, spec.slice(5), "package.json");
    return existsSync(pj) ? (JSON.parse(readFileSync(pj, "utf8")).version as string) : null;
  }
  const nm = path.join(root, "node_modules", name, "package.json");
  if (existsSync(nm)) return JSON.parse(readFileSync(nm, "utf8")).version as string;
  const exact = /\d+\.\d+\.\d+/.exec(spec);
  return exact ? exact[0] : null;
}

export function readLocalAdvisories(root: string): Advisory[] {
  const p = path.join(root, "advisories.json");
  if (!existsSync(p)) return [];
  return (JSON.parse(readFileSync(p, "utf8")).advisories ?? []) as Advisory[];
}

/** Real mode: OSV querybatch for the given name@version pairs. */
export async function queryOsv(pkgs: { name: string; version: string }[]): Promise<Advisory[]> {
  if (pkgs.length === 0) return [];
  const res = await fetch("https://api.osv.dev/v1/querybatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ queries: pkgs.map((p) => ({ package: { ecosystem: "npm", name: p.name }, version: p.version })) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`OSV query failed: ${res.status}`);
  const body = (await res.json()) as { results: { vulns?: { id: string }[] }[] };
  const out: Advisory[] = [];
  for (let i = 0; i < body.results.length; i++) {
    for (const v of body.results[i]?.vulns ?? []) {
      const det = (await (await fetch(`https://api.osv.dev/v1/vulns/${v.id}`, { signal: AbortSignal.timeout(10_000) })).json()) as {
        id: string;
        summary?: string;
        published?: string;
        database_specific?: { severity?: string };
        affected?: { ranges?: { events?: { fixed?: string }[] }[] }[];
      };
      const sev = (det.database_specific?.severity ?? "moderate").toLowerCase();
      const fixed = det.affected?.flatMap((a) => a.ranges ?? []).flatMap((r) => r.events ?? []).find((e) => e.fixed)?.fixed ?? null;
      out.push({
        id: det.id,
        package: pkgs[i]!.name,
        severity: (["low", "moderate", "high", "critical"].includes(sev) ? sev : "moderate") as Advisory["severity"],
        title: det.summary ?? det.id,
        vulnerableVersions: [pkgs[i]!.version],
        fixedIn: fixed,
        published: det.published ?? new Date().toISOString(),
        url: `https://osv.dev/vulnerability/${det.id}`,
      });
    }
  }
  return out;
}
