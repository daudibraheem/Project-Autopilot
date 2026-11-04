"use client";
import Link from "next/link";
import { ApprovalActions } from "@/components/ApprovalActions";
import { ContractView, Diff, GateChecklist, VerifierView } from "@/components/job";
import { Empty, ErrorNote, Loading, Mono, PageHeader } from "@/components/ui";
import { timeAgo, usd } from "@/lib/format";
import type { JobDetail, SystemInfo } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";

interface Queue {
  pending: JobDetail[];
  recent: { id: string; jobId: string; decision: string; reason: string | null; actor: string; createdAt: string; job: { goalId: string; jobType: string } }[];
}

function Review({ job, githubMode, onDone }: { job: JobDetail; githubMode?: boolean; onDone: () => void }) {
  const report = job.verifierReports.find((r) => r.attempt === job.attempt) ?? job.verifierReports[0];
  const passed = job.gateResults.filter((g) => g.passed).length;
  return (
    <article className="rounded-xl border border-line bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold">{job.goalLabel}</h2>
          <p className="mt-1 text-sm text-muted">
            <Link href={`/jobs/${job.id}`} className="font-mono text-accent hover:underline">
              {job.id}
            </Link>{" "}
            · {job.jobType} · {usd(job.costUsd)} · ready {timeAgo(job.finishedAt ?? job.createdAt)}
            {job.attempt > 1 && ` · attempt ${job.attempt}`}
          </p>
        </div>
        <div className="text-right text-sm">
          <div className="font-medium text-ok">
            Gate {passed}/{job.gateResults.length} green
          </div>
          <div className="text-muted">Verifier: {report?.verdict ?? "–"}</div>
        </div>
      </header>
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <div>
            <h3 className="mb-2 text-sm font-semibold">What the worker says it did</h3>
            <p className="text-sm leading-relaxed">{job.explanation}</p>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Diff</h3>
            <Diff diff={job.diff} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Verifier report</h3>
            <VerifierView report={report} />
          </div>
        </div>
        <div className="space-y-5">
          <div>
            <h3 className="mb-2 text-sm font-semibold">Gate checklist</h3>
            <GateChecklist results={job.gateResults} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Contract</h3>
            <ContractView c={job.contract} />
          </div>
        </div>
      </div>
      <footer className="border-t border-line bg-surface-2/60 px-6 py-4">
        <ApprovalActions jobId={job.id} attempt={job.attempt} githubMode={githubMode} onDone={onDone} />
      </footer>
    </article>
  );
}

export default function ApprovalsPage() {
  const { data, error, refresh } = usePoll<Queue>("/api/approvals", 3000);
  const { data: sys } = usePoll<SystemInfo>("/api/system", 10_000);
  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle={
          <>
            Changes that passed the verifier and every gate check. At trust levels 0–1 nothing merges without you.{" "}
            {sys?.githubMode ? "Approving marks the draft PR ready for review; it never auto-merges." : <>Approving merges the <Mono>autopilot/*</Mono> branch into <Mono>main</Mono> of the target repo.</>}
          </>
        }
      />
      <ErrorNote error={error} />
      {!data ? (
        <Loading />
      ) : (
        <div className="space-y-8">
          {data.pending.length === 0 ? <Empty>Nothing is waiting for approval.</Empty> : data.pending.map((j) => <Review key={j.id} job={j} githubMode={sys?.githubMode} onDone={refresh} />)}
          {data.recent.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold">Recent decisions</h2>
              <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                {data.recent.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-sm">
                    <span>
                      <span className={d.decision === "approve" ? "font-medium text-ok" : d.decision === "reject" ? "font-medium text-bad" : "font-medium text-warn"}>
                        {d.decision === "approve" ? "Approved" : d.decision === "reject" ? "Rejected" : "Changes requested"}
                      </span>{" "}
                      <Link href={`/jobs/${d.jobId}`} className="font-mono text-accent hover:underline">
                        {d.jobId}
                      </Link>{" "}
                      <span className="text-muted">({d.job.jobType})</span>
                      {d.reason && <span className="text-muted"> — {d.reason}</span>}
                    </span>
                    <span className="text-xs text-muted">
                      {d.actor} · {timeAgo(d.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  );
}
