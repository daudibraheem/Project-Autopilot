"use client";
import Link from "next/link";
import { useState } from "react";
import { cx, Empty, ErrorNote, Loading, PageHeader } from "@/components/ui";
import { dateTime } from "@/lib/format";
import type { AuditRow } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";

const ACTORS = ["goal_checker", "conductor", "worker", "verifier", "gate", "human", "policy", "system"];

function details(d: Record<string, unknown>): string {
  const s = Object.entries(d)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" · ");
  return s.length > 260 ? `${s.slice(0, 260)}…` : s;
}

export default function AuditPage() {
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [denied, setDenied] = useState(false);
  const qs = new URLSearchParams({ ...(actor ? { actor } : {}), ...(action ? { action } : {}), ...(denied ? { denied: "1" } : {}) });
  const { data, error } = usePoll<{ events: AuditRow[]; actions: string[] }>(`/api/audit?${qs}`, 3000);
  return (
    <>
      <PageHeader title="Audit log" subtitle="Every action and every policy denial, with the reason. Append-only." />
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Actor</span>
          <select value={actor} onChange={(e) => setActor(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
            <option value="">All actors</option>
            {ACTORS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Action</span>
          <select value={action} onChange={(e) => setAction(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
            <option value="">All actions</option>
            {data?.actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={denied} onChange={(e) => setDenied(e.target.checked)} className="h-4 w-4 accent-[var(--red)]" />
          Policy denials only
        </label>
      </div>
      <ErrorNote error={error} />
      {!data ? (
        <Loading />
      ) : data.events.length === 0 ? (
        <Empty>No matching events.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Actor</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Target</th>
                <th className="px-4 py-3 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.events.map((e) => (
                <tr key={e.id} className={cx(e.severity === "denied" ? "bg-bad-bg" : e.severity === "warn" && "bg-warn-bg/40")}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">{dateTime(e.createdAt)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{e.actor}</td>
                  <td className={cx("px-4 py-2.5 font-mono text-xs", e.severity === "denied" && "font-semibold text-bad")}>
                    {e.severity === "denied" && "⛔ "}
                    {e.action}
                  </td>
                  <td className="max-w-[220px] break-words px-4 py-2.5 font-mono text-xs">
                    {e.target}
                    {e.jobId && e.jobId !== e.target && (
                      <Link href={`/jobs/${e.jobId}`} className="block text-accent hover:underline">
                        {e.jobId}
                      </Link>
                    )}
                  </td>
                  <td className="min-w-[240px] max-w-md break-words px-4 py-2.5 text-xs text-muted">{details(e.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
