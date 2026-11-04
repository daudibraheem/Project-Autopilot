/**
 * Flaky-test classifier: logistic regression trained on ci_history.csv.
 * ML, not an LLM: it runs on every red CI run (high volume), must give consistent answers, and costs ~$0.
 */
import { prisma } from "@autopilot/db";
import { type CiRow, parseCsv } from "../seed/ci-history";
import { evaluate, type LogRegModel, type Metrics, predictProba, trainLogReg } from "./logreg";

export const MODEL_NAME = "flaky-classifier";
export const FEATURE_NAMES = ["historical_failure_rate", "rerun_passed", "files_changed_log", "test_file_touched", "time_of_day_bucket"];
export const FLAKY_HIGH = 0.7;
export const FLAKY_LOW = 0.3;

export interface FailureFeatures {
  historicalFailureRate: number;
  rerunPassed: boolean;
  filesChanged: number;
  testFileTouched: boolean;
  hour: number;
}

export const todBucket = (hour: number) => Math.floor((((hour % 24) + 24) % 24) / 6) / 3;

export function vectorize(f: FailureFeatures): number[] {
  return [f.historicalFailureRate, f.rerunPassed ? 1 : 0, Math.log1p(f.filesChanged), f.testFileTouched ? 1 : 0, todBucket(f.hour)];
}

/** Training set: failed runs only; failure rate is computed from PRIOR runs only (no leakage). */
export function buildDataset(rows: CiRow[]): { X: number[][]; y: number[] } {
  const X: number[][] = [];
  const y: number[] = [];
  const failures = new Map<string, number>();
  rows.forEach((r, i) => {
    if (r.failed && r.label) {
      const prior = failures.get(r.test_file) ?? 0;
      const rate = (prior + 1) / (i + 2); // Laplace-smoothed
      X.push(vectorize({ historicalFailureRate: rate, rerunPassed: r.rerun_passed === 1, filesChanged: r.files_changed, testFileTouched: r.test_file_touched === 1, hour: r.hour }));
      y.push(r.label === "flaky" ? 1 : 0);
    }
    if (r.failed) failures.set(r.test_file, (failures.get(r.test_file) ?? 0) + 1);
  });
  return { X, y };
}

function seededShuffle<T>(arr: T[], seed = 7): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export interface TrainedFlakyModel {
  model: LogRegModel;
  metrics: Metrics;
  featureNames: string[];
}

export function trainFlakyModel(csv: string, testFraction = 0.25): TrainedFlakyModel {
  const { X, y } = buildDataset(parseCsv(csv));
  if (X.length < 10) throw new Error(`Not enough labelled failures to train (${X.length})`);
  const idx = seededShuffle(X.map((_, i) => i));
  const nTest = Math.max(1, Math.round(idx.length * testFraction));
  const testIdx = idx.slice(0, nTest);
  const trainIdx = idx.slice(nTest);
  const model = trainLogReg(trainIdx.map((i) => X[i]!), trainIdx.map((i) => y[i]!));
  const m = evaluate(model, testIdx.map((i) => X[i]!), testIdx.map((i) => y[i]!));
  return {
    model,
    featureNames: FEATURE_NAMES,
    metrics: { ...m, support: { train: trainIdx.length, test: testIdx.length, positivesTest: testIdx.filter((i) => y[i] === 1).length } },
  };
}

export async function saveFlakyModel(t: TrainedFlakyModel) {
  const last = await prisma.mlModel.findFirst({ where: { name: MODEL_NAME }, orderBy: { version: "desc" } });
  await prisma.mlModel.updateMany({ where: { name: MODEL_NAME }, data: { active: false } });
  return prisma.mlModel.create({
    data: {
      name: MODEL_NAME,
      version: (last?.version ?? 0) + 1,
      featureNames: t.featureNames,
      weights: t.model as unknown as object,
      metrics: t.metrics as unknown as object,
      active: true,
    },
  });
}

export async function loadFlakyModel(): Promise<{ id: string; version: number; model: LogRegModel } | null> {
  const row = await prisma.mlModel.findFirst({ where: { name: MODEL_NAME, active: true }, orderBy: { version: "desc" } });
  return row ? { id: row.id, version: row.version, model: row.weights as unknown as LogRegModel } : null;
}

/** Historical failure rate of a test file over the whole CI history. */
export function failureRateFor(rows: CiRow[], testFile: string): number {
  const fails = rows.filter((r) => r.failed && r.test_file === testFile).length;
  return (fails + 1) / (rows.length + 2);
}

export type FlakyDecision = "flaky" | "real_bug" | "uncertain";

export function decide(p: number): FlakyDecision {
  return p >= FLAKY_HIGH ? "flaky" : p <= FLAKY_LOW ? "real_bug" : "uncertain";
}

export function predictFlaky(model: LogRegModel, f: FailureFeatures): { probability: number; decision: FlakyDecision } {
  const probability = predictProba(model, vectorize(f));
  return { probability, decision: decide(probability) };
}
