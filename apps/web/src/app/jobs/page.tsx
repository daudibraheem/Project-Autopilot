"use client";
import Link from "next/link";
import { Empty, ErrorNote, JobStatus, Loading, Mono, PageHeader } from "@/components/ui";
import { GOAL_SHORT, timeAgo, usd } from "@/lib/format";
import type { JobRow } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";

export default function JobsPage() {
  const { data, error } = usePoll<JobRow[]>("/api/jobs", 2500);
  return (
    <>
      <PageHeader title="Jobs" subtitle="Every job the conductor created, newest first. Open one to follow the worker live." />
      <ErrorNote error={error} />
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <Empty>No jobs yet. Run one from the Overview.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-3 font-medium">Job</th>
                <th className="px-4 py-3 font-medium">Goal</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Steps</th>
                <th className="px-4 py-3 text-right font-medium">Cost</th>
                <th className="px-4 py-3 font-medium">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((j) => (
                <tr key={j.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <Link href={`/jobs/${j.id}`} className="font-mono text-accent hover:underline">
                      {j.id}
                    </Link>
                    {j.source === "demo-bad-worker" && <span className="ml-2 text-xs text-bad">bad-worker demo</span>}
                    {j.degraded && <span className="ml-2 text-xs text-warn">degraded</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-muted">{GOAL_SHORT[j.goalId]}</span> {j.jobType}
                    {j.attempt > 1 && <span className="ml-1 text-xs text-muted">(attempt {j.attempt})</span>}
                  </td>
                  <td className="px-4 py-3">
                    <JobStatus status={j.status} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{j.steps}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{usd(j.costUsd)}</td>
                  <td className="px-4 py-3 text-muted">
                    {timeAgo(j.createdAt)}
                    {j.workerModel && (
                      <span className="block text-xs">
                        <Mono>{j.workerModel}</Mono>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
