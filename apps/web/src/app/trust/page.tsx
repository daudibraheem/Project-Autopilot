"use client";
import Link from "next/link";
import { cx, Empty, ErrorNote, Loading, PageHeader, Section } from "@/components/ui";
import { dateTime, usd } from "@/lib/format";
import { usePoll } from "@/lib/usePoll";

interface TrustData {
  promoteAfter: number;
  records: {
    jobType: string;
    level: number;
    label: string;
    consecutivePasses: number;
    totalRuns: number;
    approvals: number;
    rejections: number;
    gateFailures: number;
    autoMergeAllowed: boolean;
    lastFailureAt: string | null;
    lastFailureReason: string | null;
  }[];
  events: { id: string; jobType: string; jobId: string | null; kind: string; fromLevel: number; toLevel: number; reason: string; createdAt: string }[];
  costs: { jobType: string; _avg: { costUsd: number | null }; _sum: { costUsd: number | null }; _count: number }[];
  levels: Record<string, string>;
}

function Ladder({ level }: { level: number }) {
  return (
    <div className="flex gap-1" role="img" aria-label={`Level ${level} of 2`}>
      {[0, 1, 2].map((l) => (
        <span key={l} className={cx("h-2 w-8 rounded-full", l <= level ? "bg-accent" : "bg-surface-2 ring-1 ring-line")} />
      ))}
    </div>
  );
}

const KIND: Record<string, { label: string; cls: string }> = {
  promoted: { label: "Promoted", cls: "bg-ok-bg text-ok" },
  demoted: { label: "Demoted", cls: "bg-bad-bg text-bad" },
  approved: { label: "Approved", cls: "text-ok" },
  rejected: { label: "Rejected", cls: "text-bad" },
  gate_failed: { label: "Gate failed", cls: "text-bad" },
};

export default function TrustPage() {
  const { data, error } = usePoll<TrustData>("/api/trust", 3000);
  return (
    <>
      <PageHeader
        title="Trust ledger"
        subtitle={
          data
            ? `Autonomy is earned per job type. ${data.promoteAfter} consecutive approved passes promote one level; any gate failure or rejection demotes one level. L2 auto-merge also needs autoMergeAllowed (off by default) and never applies to high-risk paths.`
            : undefined
        }
      />
      <ErrorNote error={error} />
      {!data ? (
        <Loading />
      ) : (
        <div className="space-y-8">
          <div className="grid gap-4 md:grid-cols-3">
            {data.records.map((r) => {
              const cost = data.costs.find((c) => c.jobType === r.jobType);
              return (
                <div key={r.jobType} className="rounded-xl border border-line bg-surface p-5">
                  <div className="font-mono text-xs text-muted">{r.jobType}</div>
                  <div className="mt-2 text-lg font-semibold">{r.label}</div>
                  <div className="mt-2">
                    <Ladder level={r.level} />
                  </div>
                  <p className="mt-3 text-sm">
                    {r.level < 2 ? (
                      <>
                        <strong className="tabular-nums">
                          {r.consecutivePasses}/{data.promoteAfter}
                        </strong>{" "}
                        approved passes toward L{r.level + 1}
                      </>
                    ) : (
                      "Highest level"
                    )}
                  </p>
                  <dl className="mt-4 grid grid-cols-2 gap-y-1.5 text-sm">
                    <dt className="text-muted">Runs</dt>
                    <dd className="text-right tabular-nums">{r.totalRuns}</dd>
                    <dt className="text-muted">Approvals</dt>
                    <dd className="text-right tabular-nums">{r.approvals}</dd>
                    <dt className="text-muted">Rejections</dt>
                    <dd className="text-right tabular-nums">{r.rejections}</dd>
                    <dt className="text-muted">Gate failures</dt>
                    <dd className="text-right tabular-nums">{r.gateFailures}</dd>
                    <dt className="text-muted">Avg cost / job</dt>
                    <dd className="text-right tabular-nums">{usd(cost?._avg.costUsd ?? 0)}</dd>
                    <dt className="text-muted">Auto-merge allowed</dt>
                    <dd className="text-right">{r.autoMergeAllowed ? "yes" : "no"}</dd>
                  </dl>
                  {r.lastFailureReason && (
                    <p className="mt-3 text-xs text-muted">
                      Last failure: {r.lastFailureReason} {r.lastFailureAt && `(${dateTime(r.lastFailureAt)})`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <Section title="History" aside="Never overwritten">
            {data.events.length === 0 ? (
              <Empty>No trust events yet.</Empty>
            ) : (
              <ol className="space-y-2">
                {data.events.map((e) => {
                  const k = KIND[e.kind] ?? { label: e.kind, cls: "" };
                  const big = e.kind === "promoted" || e.kind === "demoted";
                  return (
                    <li key={e.id} className={cx("flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-sm", big && k.cls)}>
                      <span className="w-36 shrink-0 text-xs text-muted">{dateTime(e.createdAt)}</span>
                      <span className={cx("font-medium", !big && k.cls)}>{k.label}</span>
                      <span className="font-mono text-xs">{e.jobType}</span>
                      {big && (
                        <span className="font-semibold">
                          L{e.fromLevel} → L{e.toLevel}
                        </span>
                      )}
                      <span className="text-muted">{e.reason}</span>
                      {e.jobId && (
                        <Link href={`/jobs/${e.jobId}`} className="font-mono text-xs text-accent hover:underline">
                          {e.jobId}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>
        </div>
      )}
    </>
  );
}
