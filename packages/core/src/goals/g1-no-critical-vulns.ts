import { readFileSync } from "node:fs";
import path from "node:path";
import { isDemoTarget } from "../config";
import { readDependencies } from "../policy";
import { type Advisory, installedVersion, queryOsv, readLocalAdvisories, vendorVersions } from "../sources";
import { withSourceDir } from "./materialize";
import type { StandingGoal } from "./types";

const DAY = 86400_000;
export const CRITICAL_GRACE_DAYS = 7;

export interface OpenAdvisory extends Advisory {
  installed: string;
  spec: string;
  openDays: number;
  availableVersions: string[];
}

export const g1NoCriticalVulns: StandingGoal = {
  id: "no-critical-vulns",
  label: "G1 · No critical vulnerabilities",
  description: `Red if a critical advisory has been open for more than ${CRITICAL_GRACE_DAYS} days. Amber if any advisory is open.`,
  async check(source) {
    return withSourceDir(source, async (dir) => {
      const pkgText = readFileSync(path.join(dir, "package.json"), "utf8");
      const deps = readDependencies(pkgText);
      const demo = isDemoTarget(dir);
      const installed = Object.entries(deps).map(([name, spec]) => ({ name, spec, version: installedVersion(dir, name, spec) }));
      let advisories: Advisory[];
      if (demo) advisories = readLocalAdvisories(dir);
      else {
        const known = installed.filter((d): d is { name: string; spec: string; version: string } => Boolean(d.version));
        advisories = await queryOsv(known.map((d) => ({ name: d.name, version: d.version })));
      }
      const now = Date.now();
      const open: OpenAdvisory[] = [];
      for (const a of advisories) {
        const dep = installed.find((d) => d.name === a.package);
        if (!dep?.version || !a.vulnerableVersions.includes(dep.version)) continue;
        open.push({
          ...a,
          installed: dep.version,
          spec: dep.spec,
          openDays: Math.floor((now - new Date(a.published).getTime()) / DAY),
          availableVersions: demo ? vendorVersions(dir, a.package) : [],
        });
      }
      const overdueCritical = open.filter((a) => a.severity === "critical" && a.openDays > CRITICAL_GRACE_DAYS);
      const status = overdueCritical.length ? "red" : open.length ? "amber" : "green";
      const summary = overdueCritical.length
        ? `${overdueCritical[0]!.package}@${overdueCritical[0]!.installed}: critical ${overdueCritical[0]!.id}, open ${overdueCritical[0]!.openDays} days (fixed in ${overdueCritical[0]!.fixedIn})`
        : open.length
          ? `${open.length} open advisory(ies), none critical and overdue`
          : `No open advisories across ${installed.length} dependencies`;
      return {
        goalId: "no-critical-vulns",
        status,
        summary,
        evidence: { mode: demo ? "demo (local advisories.json)" : "real (OSV)", dependencies: installed, openAdvisories: open },
      };
    });
  },
};
