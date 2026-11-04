/**
 * Synthetic CI history for the flaky-test classifier (deterministic, seeded).
 * One row per CI run on main. Rows with failed=1 carry a ground-truth label.
 */
export interface CiRow {
  run_id: number;
  timestamp: string;
  commit: string;
  test_file: string;
  test_name: string;
  failed: 0 | 1;
  rerun_passed: 0 | 1;
  files_changed: number;
  test_file_touched: 0 | 1;
  hour: number;
  label: "" | "flaky" | "real";
}

export const CI_HEADER: (keyof CiRow)[] = [
  "run_id",
  "timestamp",
  "commit",
  "test_file",
  "test_name",
  "failed",
  "rerun_passed",
  "files_changed",
  "test_file_touched",
  "hour",
  "label",
];

const TESTS = [
  { file: "test/fx.test.js", name: "converts EUR invoices within the rate-service deadline" },
  { file: "test/invoice.test.js", name: "rounds tax to the nearest cent" },
  { file: "test/invoice.test.js", name: "computes subtotal, tax and total" },
  { file: "test/due.test.js", name: "due date is 30 days after issue by default" },
  { file: "test/invoice.test.js", name: "applies a discount before tax" },
];

function mulberry32(a: number) {
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateCiHistory(runs = 300, seed = 42, end = new Date("2026-10-31T18:00:00Z")): CiRow[] {
  const r = mulberry32(seed);
  const rows: CiRow[] = [];
  for (let i = 0; i < runs; i++) {
    const ts = new Date(end.getTime() - (runs - i) * 3.1 * 3600_000);
    const hour = ts.getUTCHours();
    const busy = hour >= 9 && hour <= 17;
    const filesChanged = 1 + Math.floor(r() ** 2 * 14);
    const commit = Math.floor(r() * 0xfffffff).toString(16).padStart(7, "0");
    const base = { run_id: 1000 + i, timestamp: ts.toISOString(), commit, files_changed: filesChanged, hour };
    const roll = r();
    const flakyP = busy ? 0.32 : 0.2;
    if (roll < flakyP) {
      // flaky: fx test times out; re-run usually passes; test file rarely touched
      rows.push({
        ...base,
        test_file: TESTS[0]!.file,
        test_name: TESTS[0]!.name,
        failed: 1,
        rerun_passed: r() < 0.9 ? 1 : 0,
        test_file_touched: r() < 0.05 ? 1 : 0,
        label: "flaky",
      });
    } else if (roll < flakyP + 0.17) {
      // real failure in one of the stable tests: re-run fails, often touches the test or many files
      const t = TESTS[1 + Math.floor(r() * (TESTS.length - 1))]!;
      rows.push({
        ...base,
        files_changed: filesChanged + Math.floor(r() * 6),
        test_file: t.file,
        test_name: t.name,
        failed: 1,
        rerun_passed: r() < 0.08 ? 1 : 0,
        test_file_touched: r() < 0.45 ? 1 : 0,
        label: "real",
      });
    } else {
      rows.push({ ...base, test_file: "", test_name: "", failed: 0, rerun_passed: 0, test_file_touched: 0, label: "" });
    }
  }
  return rows;
}

function csvCell(v: unknown): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: CiRow[]): string {
  return [CI_HEADER.join(","), ...rows.map((row) => CI_HEADER.map((h) => csvCell(row[h])).join(","))].join("\n") + "\n";
}

export function parseCsv(text: string): CiRow[] {
  const lines = text.trim().split(/\r?\n/);
  const header = splitCsvLine(lines[0] ?? "");
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const o: Record<string, string> = {};
    header.forEach((h, i) => {
      o[h] = cells[i] ?? "";
    });
    return {
      run_id: Number(o.run_id),
      timestamp: o.timestamp ?? "",
      commit: o.commit ?? "",
      test_file: o.test_file ?? "",
      test_name: o.test_name ?? "",
      failed: o.failed === "1" ? 1 : 0,
      rerun_passed: o.rerun_passed === "1" ? 1 : 0,
      files_changed: Number(o.files_changed),
      test_file_touched: o.test_file_touched === "1" ? 1 : 0,
      hour: Number(o.hour),
      label: (o.label as CiRow["label"]) ?? "",
    };
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}
