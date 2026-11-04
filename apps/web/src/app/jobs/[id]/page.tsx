"use client";
import Link from "next/link";
import { use } from "react";
import { ApprovalActions } from "@/components/ApprovalActions";
import { ContractView, Diff, EvidenceList, GateChecklist, Timeline, VerifierView } from "@/components/job";
import { ErrorNote, JobStatus, Loading, Mono, Section } from "@/components/ui";
import { dateTime, usd } from "@/lib/format";
import type { JobDetail, SystemInfo } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: job, error, refresh } = usePoll<JobDetail>(`/api/jobs/${id}`, 2000);
  const { data: sys } = usePoll<SystemInfo>("/api/system", 10_000);
  if (error && !job) return <ErrorNote error={error} />;
  if (!job) return <Loading />;
  const report = job.verifierReports.find((r) => r.attempt === job.attempt) ?? job.verifierReports[0];
  const denials = job.audit.filter((a) => a.severity === "denied");
  return (
    <>
      <nav className="mb-4 text-sm text-muted">
        <Link href="/jobs" className="hover:text-fg">
          Jobs
        </Link>{" "}
        / <Mono>{job.id}</Mono>
      </nav>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{job.goalLabel}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted">
            <JobStatus status={job.status} />
            <span>{job.jobType}</span>
            <Mono>{job.branch}</Mono>
            {job.attempt > 1 && <span>attempt {job.attempt}</span>}
            {job.degraded && <span className="font-medium text-warn">degraded (mock fallback)</span>}
            {job.source === "demo-bad-worker" && <span className="font-medium text-bad">scripted bad worker</span>}
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-6 text-right">
          <div>
            <dt className="text-xs text-muted">Cost</dt>
            <dd className="text-lg font-semibold tabular-nums">{usd(job.costUsd)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Tokens</dt>
            <dd className="text-lg font-semibold tabular-nums">{(job.tokensIn + job.tokensOut).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Steps</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {job.stepsUsed}
              <span className="text-sm font-normal text-muted">/{job.contract?.maxSteps}</span>
            </dd>
          </div>
        </dl>
      </div>

      {job.status === "awaiting_approval" && (
        <div className="mb-6 rounded-xl border border-warn/40 bg-warn-bg/50 p-5">
          <p className="mb-3 text-sm">
            <strong>Your decision.</strong> The verifier passed it and every gate check is green. Nothing reaches <Mono>main</Mono> until you approve.
          </p>
          <ApprovalActions jobId={job.id} attempt={job.attempt} githubMode={sys?.githubMode} onDone={refresh} />
        </div>
      )}
      {job.error && !["merged", "approved"].includes(job.status) && <p className="mb-6 rounded-lg bg-bad-bg px-4 py-3 text-sm text-bad">{job.error}</p>}
      {job.prUrl && (
        <p className="mb-6 text-sm">
          Draft PR:{" "}
          <a className="text-accent underline" href={job.prUrl} target="_blank" rel="noreferrer">
            {job.prUrl}
          </a>
        </p>
      )}
      {job.mergedSha && (
        <p className="mb-6 rounded-lg bg-ok-bg px-4 py-3 text-sm text-ok">
          Merged into main as <Mono>{job.mergedSha.slice(0, 10)}</Mono> after human approval.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {job.explanation && (
            <Section title="Worker explanation" aside={<Mono>{job.workerModel}</Mono>}>
              <p className="text-sm leading-relaxed">{job.explanation}</p>
              {job.feedback && <p className="mt-3 text-sm text-muted">Reviewer feedback for this attempt: “{job.feedback}”</p>}
            </Section>
          )}
          <Section title="Step timeline" aside={["running", "verifying", "gating", "queued"].includes(job.status) ? "Live · refreshes every 2 s" : `${job.steps.length} steps`}>
            <Timeline steps={job.steps} />
          </Section>
          <Section title="Diff" aside={job.branch}>
            <Diff diff={job.diff} />
          </Section>
          <Section title="Gate checklist" aside="Plain code, no AI">
            <GateChecklist results={job.gateResults} />
          </Section>
          <Section title="Verifier report" aside={job.verifierModel ? `Different model from the worker (${job.workerModel})` : undefined}>
            <VerifierView report={report} />
          </Section>
        </div>
        <div className="space-y-6">
          <Section title="Contract">
            <ContractView c={job.contract} />
          </Section>
          <Section title="Evidence" aside="Commands, exit codes, denials">
            <EvidenceList evidence={job.evidence} />
          </Section>
          <Section title="Trust">
            <p className="text-sm">
              {job.jobType}: <strong>{job.trust.label}</strong>
            </p>
            <p className="mt-1 text-xs text-muted">
              Level when this job started: L{job.trustLevelAtStart}. Consecutive approved passes: {job.trust.consecutivePasses}.
            </p>
          </Section>
          {(denials.length > 0 || job.approvals.length > 0) && (
            <Section title="Decisions and denials">
              <ul className="space-y-2 text-sm">
                {denials.map((d) => (
                  <li key={d.id} className="rounded-lg bg-bad-bg px-3 py-2 text-bad">
                    <div className="font-medium">Policy blocked: {d.target}</div>
                    <div className="text-xs">{String(d.details.reason ?? "")}</div>
                  </li>
                ))}
                {job.approvals.map((a) => (
                  <li key={a.id} className="rounded-lg bg-surface-2 px-3 py-2">
                    <div className="font-medium">
                      {a.decision.replace("_", " ")} by {a.actor}
                    </div>
                    {a.reason && <div className="text-xs text-muted">{a.reason}</div>}
                    <div className="text-xs text-muted">{dateTime(a.createdAt)}</div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
