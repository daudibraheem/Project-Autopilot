"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, cx, ErrorNote, GoalStatus, goalTone, JobStatus, Loading, PageHeader } from "@/components/ui";
import { GOAL_SHORT, hours, timeAgo, usd } from "@/lib/format";
import type { GoalView, Overview } from "@/lib/types";
import { post, usePoll } from "@/lib/usePoll";

function KillSwitch({ on, onChange }: { on: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-1.5">
      <span id="ks-label" className="text-sm">
        Kill switch
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby="ks-label"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await post("/api/killswitch", { on: !on });
            onChange();
          } finally {
            setBusy(false);
          }
        }}
        className={cx("relative h-6 w-11 rounded-full transition-colors", on ? "bg-bad" : "bg-surface-2 ring-1 ring-line")}
      >
        <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-transform", on ? "translate-x-5" : "translate-x-0.5")} />
      </button>
      <span className={cx("w-7 text-xs font-semibold", on ? "text-bad" : "text-muted")}>{on ? "ON" : "off"}</span>
    </div>
  );
}

function HistoryStrip({ history }: { history: GoalView["history"] }) {
  if (history.length === 0) return null;
  return (
    <div className="flex items-center gap-[3px]" role="img" aria-label={`Last ${history.length} checks`}>
      {history.map((h, i) => (
        <span key={i} title={`${h.status} · ${new Date(h.createdAt).toLocaleString()}`} className={cx("h-4 w-1.5 rounded-sm", goalTone(h.status).dot, "opacity-80")} />
      ))}
    </div>
  );
}

function evidenceLines(g: GoalView): string[] {
  const ev = g.latest?.evidence ?? {};
  if (g.goalId === "no-critical-vulns") {
    const a = (ev.openAdvisories as { id: string; severity: string; openDays: number; fixedIn: string; package: string; installed: string }[]) ?? [];
    return a.map((x) => `${x.id} · ${x.severity} · ${x.package}@${x.installed} → fixed in ${x.fixedIn} · open ${x.openDays} days`);
  }
  if (g.goalId === "main-build-green") {
    const f = (ev.failures as { file: string; name: string; rerunPassed: boolean; message: string }[]) ?? [];
    return f.map((x) => `${x.file} › ${x.name} — ${x.message}${x.rerunPassed ? " (passed on CI re-run)" : ""}`);
  }
  const steps = (ev.steps as { command: string; exitCode: number }[]) ?? [];
  return steps.map((s) => `${s.exitCode === 0 ? "✓" : "✕"} ${s.command}${s.exitCode ? `  (exit ${s.exitCode})` : ""}`);
}

function GoalPanel({ g, openJob, onRun, killSwitch }: { g: GoalView; openJob?: { id: string; status: string }; onRun: () => Promise<void>; killSwitch: boolean }) {
  const status = g.latest?.status;
  const prev = useRef<string | undefined>(undefined);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (prev.current && status && prev.current !== status) {
      setChanged(true);
      const t = setTimeout(() => setChanged(false), 3000);
      return () => clearTimeout(t);
    }
    prev.current = status;
  }, [status]);
  useEffect(() => {
    prev.current = status;
  });
  const flash = status === "green" ? "var(--green)" : status === "red" ? "var(--red)" : "var(--amber)";
  const lines = evidenceLines(g);
  return (
    <article
      className={cx("grid gap-6 rounded-xl border border-line bg-surface p-6 transition-colors md:grid-cols-[180px_1fr_170px]", changed && "status-changed")}
      style={{ ["--flash" as string]: flash }}
      aria-live="polite"
    >
      <div className={cx("border-l-4 pl-4", status === "green" ? "border-ok" : status === "red" ? "border-bad" : status === "amber" ? "border-warn" : "border-line")}>
        <div className="font-mono text-xs text-muted">{GOAL_SHORT[g.goalId]}</div>
        <h2 className="mt-1 text-base font-semibold leading-snug">{g.label.replace(/^G\d · /, "")}</h2>
        <div className="mt-3">
          <GoalStatus status={status} large />
        </div>
        {changed && <p className="mt-2 text-xs font-medium" style={{ color: flash }}>Just changed from {goalTone(g.previousStatus ?? undefined).label.toLowerCase()}</p>}
      </div>

      <div className="min-w-0">
        <p className="text-sm">{g.latest?.summary ?? "Not checked yet. Use “Check goals now”."}</p>
        {lines.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-lg bg-surface-2 px-3 py-2.5 font-mono text-xs text-muted">
            {lines.slice(0, 4).map((l, i) => (
              <li key={i} className="truncate" title={l}>
                {l}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>Checked {timeAgo(g.latest?.createdAt)}</span>
          <HistoryStrip history={g.history} />
        </div>
        <p className="mt-2 text-xs text-muted">{g.description}</p>
      </div>

      <div className="flex flex-col justify-between gap-4 md:items-end md:text-right">
        <div>
          <div className="text-2xl font-semibold tabular-nums">{hours(g.hoursBrokenWeek)}</div>
          <div className="text-xs text-muted">broken this week</div>
        </div>
        {openJob ? (
          <Link href={`/jobs/${openJob.id}`} className="flex flex-col gap-1 text-sm font-medium text-accent hover:underline md:items-end">
            <JobStatus status={openJob.status} />
            <span>
              View job <span className="font-mono">{openJob.id}</span> →
            </span>
          </Link>
        ) : (
          <div className="flex flex-col gap-1 md:items-end">
            <Button
              variant={status === "red" ? "primary" : "secondary"}
              disabled={status === "green" || !status || killSwitch}
              busy={busy}
              title={killSwitch ? "Kill switch is on" : status === "green" ? "Goal is healthy" : undefined}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  await onRun();
                } catch (e) {
                  setErr((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Run job
            </Button>
            {err && <span className="max-w-[170px] text-xs text-bad">{err}</span>}
          </div>
        )}
      </div>
    </article>
  );
}

export default function OverviewPage() {
  const { data, error, refresh } = usePoll<Overview>("/api/overview", 2500);
  const [checking, setChecking] = useState<string | null>(null);
  const [checkErr, setCheckErr] = useState<string | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);

  useEffect(() => {
    if (checking && data?.lastCheckAt && new Date(data.lastCheckAt).getTime() > new Date(checking).getTime()) setChecking(null);
  }, [data?.lastCheckAt, checking]);

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Standing goals are checked by plain code. When one breaks, a sandboxed AI worker proposes a fix, a different AI verifies it, the gate decides, and you approve."
        actions={
          <>
            {data && <KillSwitch on={data.killSwitch} onChange={refresh} />}
            <Button
              variant="secondary"
              busy={Boolean(checking)}
              onClick={async () => {
                setCheckErr(null);
                try {
                  setChecking(new Date().toISOString());
                  await post("/api/goals/check");
                } catch (e) {
                  setChecking(null);
                  setCheckErr((e as Error).message);
                }
              }}
            >
              {checking ? "Checking goals…" : "Check goals now"}
            </Button>
          </>
        }
      />
      <ErrorNote error={error ?? checkErr ?? runErr} />
      {!data ? (
        <Loading />
      ) : (
        <>
          <dl className="mb-8 grid grid-cols-2 gap-x-8 gap-y-4 border-y border-line py-5 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">Open jobs</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {data.openJobCount} <span className="text-sm font-normal text-muted">/ 3 max</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">AI cost today</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {usd(data.todayCostUsd)} {data.provider === "mock" && <span className="text-xs font-normal text-muted">(mock, estimated)</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Waiting for you</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                <Link href="/approvals" className="hover:underline">
                  {data.pendingApprovals} {data.pendingApprovals === 1 ? "approval" : "approvals"}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Last goal check</dt>
              <dd className="mt-1 text-xl font-semibold">{timeAgo(data.lastCheckAt)}</dd>
            </div>
          </dl>
          <div className="space-y-4">
            {data.goals.map((g) => (
              <GoalPanel
                key={g.goalId}
                g={g}
                killSwitch={data.killSwitch}
                openJob={data.openJobs.find((j) => j.goalId === g.goalId)}
                onRun={async () => {
                  setRunErr(null);
                  await post(`/api/goals/${g.goalId}/run`);
                  await refresh();
                }}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}
