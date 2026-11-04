"use client";
import Link from "next/link";
import { cx, Empty, ErrorNote, Loading, Mono, PageHeader, Section } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { usePoll } from "@/lib/usePoll";

interface Metrics {
  precision: number;
  recall: number;
  accuracy: number;
  f1: number;
  support: { train: number; test: number; positivesTest: number };
  confusion: { tp: number; fp: number; tn: number; fn: number };
}
interface MlData {
  activeVersion: number | null;
  models: { id: string; version: number; featureNames: string[]; weights: { weights: number[]; bias: number }; metrics: Metrics; active: boolean; trainedAt: string }[];
  predictions: { id: string; jobId: string | null; testName: string; features: Record<string, unknown>; probability: number; decision: string; createdAt: string }[];
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default function MlPage() {
  const { data, error } = usePoll<MlData>("/api/ml", 5000);
  const active = data?.models.find((m) => m.active) ?? data?.models[0];
  const maxW = active ? Math.max(...active.weights.weights.map(Math.abs), 0.01) : 1;
  return (
    <>
      <PageHeader
        title="Flaky-test classifier"
        subtitle="Logistic regression in TypeScript, trained on ci_history.csv. It runs first on every red build: p(flaky) ≥ 0.7 → re-run once and propose a quarantine; ≤ 0.3 → real bug; only in between is an LLM asked to read the logs."
      />
      <ErrorNote error={error} />
      {!data ? (
        <Loading />
      ) : !active ? (
        <Empty>
          No model trained yet. Run <Mono>pnpm cli train</Mono>.
        </Empty>
      ) : (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 border-y border-line py-5 sm:grid-cols-4">
            {[
              ["Precision", active.metrics.precision],
              ["Recall", active.metrics.recall],
              ["Accuracy", active.metrics.accuracy],
              ["F1", active.metrics.f1],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-xs text-muted">{k} (held out)</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">{k === "F1" ? (v as number).toFixed(3) : pct(v as number)}</dd>
              </div>
            ))}
          </dl>
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Model" aside={`v${active.version} · trained ${dateTime(active.trainedAt)}`}>
              <p className="mb-4 text-sm text-muted">
                Trained on {active.metrics.support.train} labelled failures, tested on {active.metrics.support.test} held-out failures ({active.metrics.support.positivesTest} flaky).
              </p>
              <h3 className="mb-2 text-xs font-medium text-muted">Feature weights (standardised)</h3>
              <ul className="space-y-2">
                {active.featureNames.map((f, i) => {
                  const w = active.weights.weights[i] ?? 0;
                  return (
                    <li key={f} className="grid grid-cols-[170px_1fr_52px] items-center gap-3 text-sm">
                      <Mono>{f}</Mono>
                      <span className="relative h-2 rounded-full bg-surface-2">
                        <span className={cx("absolute top-0 h-2 rounded-full", w >= 0 ? "left-1/2 bg-accent" : "right-1/2 bg-warn")} style={{ width: `${(Math.abs(w) / maxW) * 50}%` }} />
                      </span>
                      <span className="text-right font-mono text-xs tabular-nums">{w.toFixed(2)}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-muted">Positive weights push towards “flaky”.</p>
            </Section>
            <Section title="Confusion matrix" aside="held-out split">
              <table className="w-full max-w-sm text-center text-sm">
                <thead>
                  <tr className="text-xs text-muted">
                    <th />
                    <th className="pb-2 font-medium">Predicted flaky</th>
                    <th className="pb-2 font-medium">Predicted real</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th className="pr-3 text-right text-xs font-medium text-muted">Actually flaky</th>
                    <td className="rounded-lg bg-ok-bg py-4 text-lg font-semibold text-ok">{active.metrics.confusion.tp}</td>
                    <td className="py-4 text-lg font-semibold">{active.metrics.confusion.fn}</td>
                  </tr>
                  <tr>
                    <th className="pr-3 text-right text-xs font-medium text-muted">Actually real</th>
                    <td className="py-4 text-lg font-semibold">{active.metrics.confusion.fp}</td>
                    <td className="rounded-lg bg-ok-bg py-4 text-lg font-semibold text-ok">{active.metrics.confusion.tn}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-4 text-sm text-muted">
                Why ML and not an LLM: this runs on every red CI run (high volume), the same evidence must always give the same answer, and it costs effectively nothing.
              </p>
            </Section>
          </div>
          <Section title="Recent predictions">
            {data.predictions.length === 0 ? (
              <Empty>No predictions yet. Run the G2 job.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      <th className="py-2 pr-4 font-medium">Test</th>
                      <th className="py-2 pr-4 text-right font-medium">p(flaky)</th>
                      <th className="py-2 pr-4 font-medium">Decision</th>
                      <th className="py-2 pr-4 font-medium">Job</th>
                      <th className="py-2 font-medium">When</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.predictions.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2 pr-4 font-mono text-xs">{p.testName}</td>
                        <td className="py-2 pr-4 text-right font-mono tabular-nums">{p.probability.toFixed(3)}</td>
                        <td className="py-2 pr-4">
                          <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", p.decision === "flaky" ? "bg-warn-bg text-warn" : p.decision === "real_bug" ? "bg-bad-bg text-bad" : "bg-surface-2 text-muted")}>
                            {p.decision === "real_bug" ? "real bug" : p.decision}
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          {p.jobId && (
                            <Link href={`/jobs/${p.jobId}`} className="font-mono text-xs text-accent hover:underline">
                              {p.jobId}
                            </Link>
                          )}
                        </td>
                        <td className="py-2 text-xs text-muted">{dateTime(p.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          {data.models.length > 1 && (
            <Section title="Model versions">
              <ul className="space-y-1 text-sm">
                {data.models.map((m) => (
                  <li key={m.id}>
                    v{m.version} · precision {pct(m.metrics.precision)} · recall {pct(m.metrics.recall)} · {dateTime(m.trainedAt)} {m.active && <strong>(active)</strong>}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </>
  );
}
