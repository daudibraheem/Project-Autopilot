/**
 * Sprint forecast: plain-code Monte Carlo (no LLM). Bootstraps daily throughput from past sprints
 * and simulates the remaining days 10,000 times to estimate the chance of finishing the sprint's work.
 * Deterministic with a fixed seed (used in mock mode) so the demo and tests are repeatable.
 */
import { prisma } from "@autopilot/db";
import { activeSprint, sprintItems } from "./data";

const DAY = 86400_000;
export const DEFAULT_RUNS = 10_000;
export const DEFAULT_SEED = 42;

/** mulberry32: a tiny deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Poisson(λ) via Knuth, driven by a seeded rng — gives realistic day-to-day throughput variance. */
export function samplePoisson(lambda: number, rng: () => number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

export interface ForecastInput {
  remainingPoints: number;
  completedPoints: number;
  totalPoints: number;
  daysElapsed: number;
  daysRemaining: number;
  sprintLengthDays: number;
  /** Points completed per past sprint. */
  pastThroughput: number[];
  runs?: number;
  seed?: number;
}

export interface BurnupPoint {
  day: number;
  target: number;
  actual: number | null;
  p10: number;
  p50: number;
  p90: number;
}

export interface ForecastResult {
  probability: number;
  runs: number;
  dailyRateMean: number;
  remainingPoints: number;
  completedPoints: number;
  totalPoints: number;
  daysRemaining: number;
  finalP10: number;
  finalP50: number;
  finalP90: number;
  burnup: BurnupPoint[];
  pastThroughput: number[];
  why: string;
}

const quantile = (sorted: number[], q: number): number => {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i]!;
};

/** Pure Monte Carlo. remaining ≤ 0 → 100%; no days left with work remaining → 0%. */
export function runForecast(input: ForecastInput): ForecastResult {
  const runs = input.runs ?? DEFAULT_RUNS;
  const seed = input.seed ?? DEFAULT_SEED;
  const dailyRates = input.pastThroughput.length
    ? input.pastThroughput.map((t) => t / Math.max(1, input.sprintLengthDays))
    : [input.completedPoints / Math.max(1, input.daysElapsed || 1)];
  const dailyRateMean = dailyRates.reduce((a, b) => a + b, 0) / dailyRates.length;

  const base = {
    runs,
    dailyRateMean,
    remainingPoints: input.remainingPoints,
    completedPoints: input.completedPoints,
    totalPoints: input.totalPoints,
    daysRemaining: input.daysRemaining,
    pastThroughput: input.pastThroughput,
  };

  const mkWhy = (p: number) =>
    `Based on ${input.pastThroughput.length} past sprints (about ${dailyRateMean.toFixed(1)} points/day), with ${input.remainingPoints} points left and ${input.daysRemaining} day(s) to go, Autopilot ran ${runs.toLocaleString()} simulations: ${Math.round(
      p * 100,
    )}% finished the remaining work in time. [sprint]`;

  if (input.remainingPoints <= 0) {
    const done = input.completedPoints;
    return { ...base, probability: 1, finalP10: done, finalP50: done, finalP90: done, burnup: buildBurnup(input, [], done), why: `All work is complete: 0 points remain, so the sprint goal is already met. [sprint]` };
  }
  if (input.daysRemaining <= 0) {
    return { ...base, probability: 0, finalP10: input.completedPoints, finalP50: input.completedPoints, finalP90: input.completedPoints, burnup: buildBurnup(input, [], input.completedPoints), why: `No days remain and ${input.remainingPoints} points are unfinished, so the sprint goal cannot be met in time. [sprint]` };
  }

  const rng = mulberry32(seed);
  const finals: number[] = [];
  let successes = 0;
  for (let r = 0; r < runs; r++) {
    let produced = 0;
    // Each day: bootstrap a historical daily rate, then draw that day's output with Poisson variance.
    for (let d = 0; d < input.daysRemaining; d++) produced += samplePoisson(dailyRates[Math.floor(rng() * dailyRates.length)]!, rng);
    if (produced >= input.remainingPoints) successes++;
    finals.push(input.completedPoints + produced);
  }
  finals.sort((a, b) => a - b);
  const probability = successes / runs;
  return {
    ...base,
    probability,
    finalP10: Math.round(quantile(finals, 0.1)),
    finalP50: Math.round(quantile(finals, 0.5)),
    finalP90: Math.round(quantile(finals, 0.9)),
    burnup: buildBurnup(input, finals, input.completedPoints),
    why: mkWhy(probability),
  };
}

/** Burn-up: target (total scope), actual-so-far, and a forecast band for the remaining days. */
function buildBurnup(input: ForecastInput, _finals: number[], completed: number): BurnupPoint[] {
  const len = Math.max(1, input.sprintLengthDays);
  const elapsed = Math.min(len, Math.max(0, input.daysElapsed));
  const rate = input.pastThroughput.length ? input.pastThroughput.reduce((a, b) => a + b, 0) / input.pastThroughput.length / len : completed / Math.max(1, elapsed || 1);
  const out: BurnupPoint[] = [];
  for (let day = 0; day <= len; day++) {
    const actual = day <= elapsed ? Math.round((completed * day) / Math.max(1, elapsed || 1)) : null;
    const future = Math.max(0, day - elapsed);
    const mid = completed + rate * future;
    out.push({
      day,
      target: input.totalPoints,
      actual,
      p10: Math.min(input.totalPoints, Math.round(completed + rate * 0.6 * future)),
      p50: Math.min(input.totalPoints, Math.round(mid)),
      p90: Math.min(input.totalPoints, Math.round(completed + rate * 1.4 * future)),
    });
  }
  return out;
}

/** S3 thresholds: green ≥ 70%, amber 40–70%, red < 40%. */
export function forecastStatus(probability: number): "green" | "amber" | "red" {
  if (probability >= 0.7) return "green";
  if (probability >= 0.4) return "amber";
  return "red";
}

/** Gather the forecast inputs for the active sprint from the database. */
export async function gatherForecastInput(now = new Date(), opts: { runs?: number; seed?: number } = {}): Promise<{ sprint: Awaited<ReturnType<typeof activeSprint>>; input: ForecastInput | null }> {
  const sprint = await activeSprint();
  if (!sprint) return { sprint, input: null };
  const items = await sprintItems(sprint.id);
  const pts = (i: (typeof items)[number]) => i.storyPoints ?? 0;
  const totalPoints = items.reduce((n, i) => n + pts(i), 0);
  const completedPoints = items.filter((i) => i.statusCategory === "done").reduce((n, i) => n + pts(i), 0);
  const remainingPoints = Math.max(0, totalPoints - completedPoints);
  const sprintLengthDays = Math.max(1, Math.round((sprint.end.getTime() - sprint.start.getTime()) / DAY));
  const daysElapsed = Math.min(sprintLengthDays, Math.max(0, Math.round((now.getTime() - sprint.start.getTime()) / DAY)));
  const daysRemaining = Math.max(0, sprintLengthDays - daysElapsed);
  const past = await prisma.sprint.findMany({ where: { state: "closed", throughput: { not: null } }, orderBy: { start: "desc" }, take: 6, select: { throughput: true } });
  const pastThroughput = past.map((p) => p.throughput ?? 0).filter((t) => t > 0);
  return {
    sprint,
    input: { remainingPoints, completedPoints, totalPoints, daysElapsed, daysRemaining, sprintLengthDays, pastThroughput, runs: opts.runs, seed: opts.seed },
  };
}

export async function forecastSprint(now = new Date(), opts: { runs?: number; seed?: number } = {}): Promise<{ sprint: Awaited<ReturnType<typeof activeSprint>>; forecast: ForecastResult | null }> {
  const { sprint, input } = await gatherForecastInput(now, opts);
  return { sprint, forecast: input ? runForecast(input) : null };
}
