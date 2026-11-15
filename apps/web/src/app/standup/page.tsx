"use client";
import Link from "next/link";
import { useState } from "react";
import { BriefView, Counts } from "@/components/team";
import { Button, cx, Empty, ErrorNote, JobStatus, Loading, Mono, PageHeader, Section } from "@/components/ui";
import { dateTime } from "@/lib/format";
import type { Brief, BriefContent, People } from "@/lib/types";
import { post, usePoll } from "@/lib/usePoll";

interface StandupData {
  today: string;
  brief: Brief | null;
  history: { id: string; date: string; status: string; jobId: string | null; publishedAt: string | null; publishedBy: string | null; createdAt: string }[];
  counts: BriefContent["counts"];
  openJob: { id: string; status: string } | null;
  people: People;
}

const STATUS: Record<string, string> = {
  published: "bg-ok-bg text-ok",
  awaiting_approval: "bg-warn-bg text-warn",
  blocked: "bg-bad-bg text-bad",
  rejected: "bg-bad-bg text-bad",
  pending: "bg-surface-2 text-muted",
};

export default function StandupPage() {
  const { data, error, refresh } = usePoll<StandupData>("/api/standup", 2500);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  return (
    <>
      <PageHeader
        title="Standup"
        subtitle="Facts are computed by plain code; the worker only words them. Every sentence links to its sources. Counts are rechecked against the database by the gate. Published to this dashboard only; nothing is posted anywhere."
        actions={
          <Button
            variant="primary"
            busy={busy}
            disabled={Boolean(data?.openJob)}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                const r = await post<{ jobId: string }>("/api/standup/generate");
                setJobId(r.jobId);
                refresh();
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Generate brief now
          </Button>
        }
      />
      <ErrorNote error={error ?? err} />
      {(data?.openJob || jobId) && (
        <p className="mb-6 flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
          {data?.openJob && <JobStatus status={data.openJob.status} />}
          Generating brief:{" "}
          <Link href={`/jobs/${data?.openJob?.id ?? jobId}`} className="font-mono text-accent hover:underline">
            {data?.openJob?.id ?? jobId}
          </Link>
        </p>
      )}
      {!data ? (
        <Loading />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-6">
            <Section
              title={`Today's brief · ${data.today}`}
              aside={
                data.brief ? (
                  <span className={cx("rounded-full px-2 py-0.5 font-medium", STATUS[data.brief.status])}>
                    {data.brief.status === "published"
                      ? `Published ${data.brief.publishedAt ? dateTime(data.brief.publishedAt) : ""} by ${data.brief.publishedBy}`
                      : data.brief.status === "awaiting_approval"
                        ? "Waiting for approval"
                        : data.brief.status}
                  </span>
                ) : undefined
              }
            >
              {data.brief?.content?.sections ? (
                <>
                  {data.brief.status === "awaiting_approval" && (
                    <p className="mb-4 rounded-lg bg-warn-bg px-4 py-2.5 text-sm text-warn">
                      Not published yet. Review it in{" "}
                      <Link href="/approvals" className="font-medium underline">
                        Approvals
                      </Link>
                      .
                    </p>
                  )}
                  <BriefView content={data.brief.content} people={data.people} />
                </>
              ) : (
                <Empty>No brief for today yet. Click “Generate brief now”.</Empty>
              )}
            </Section>
          </div>
          <div className="space-y-6">
            <Section title="Counts now" aside="recomputed from the database">
              <Counts counts={data.counts} />
              {data.brief?.content?.counts && (
                <p className="mt-3 text-xs text-muted">
                  Brief says: done {data.brief.content.counts.done} · in progress {data.brief.content.counts.inProgress} · stuck {data.brief.content.counts.stuck} · added{" "}
                  {data.brief.content.counts.addedMidSprint}
                </p>
              )}
            </Section>
            <Section title="History">
              {data.history.length === 0 ? (
                <Empty>No briefs yet.</Empty>
              ) : (
                <ul className="space-y-2 text-sm">
                  {data.history.map((h) => (
                    <li key={h.id} className="flex items-center justify-between gap-2">
                      <span>
                        {h.date}{" "}
                        {h.jobId && (
                          <Link href={`/jobs/${h.jobId}`} className="font-mono text-xs text-accent hover:underline">
                            {h.jobId}
                          </Link>
                        )}
                      </span>
                      <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", STATUS[h.status] ?? "bg-surface-2 text-muted")}>{h.status.replace("_", " ")}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-muted">
                Blocked briefs failed the gate (e.g. <Mono>pnpm cli demo-bad-brief</Mono>).
              </p>
            </Section>
          </div>
        </div>
      )}
    </>
  );
}
