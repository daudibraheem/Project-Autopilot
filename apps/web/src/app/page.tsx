"use client";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Gauge } from "@/components/forecast";
import { Card, EmptyState, Skeleton, StatusPill, toast } from "@/components/kit";
import { MorningRoutine } from "@/components/morning";
import { Button, cx, ErrorNote, GoalStatus, goalTone, JobStatus, PageHeader } from "@/components/ui";
import { GOAL_SHORT, hours, timeAgo } from "@/lib/format";
import type { Forecast, GoalView, Overview } from "@/lib/types";
import { post, usePoll } from "@/lib/usePoll";

function HistoryStrip({ history }: { history: GoalView["history"] }) {
  if (history.length === 0) return null;
  return (
    <div className="flex items-center gap-[3px]" role="img" aria-label={`Last ${history.length} checks`}>
      {history.map((h, i) => (
        <span key={i} title={`${h.status} · ${new Date(h.createdAt).toLocaleString()}`} className={cx("h-4 w-1.5 rounded-sm opacity-80", goalTone(h.status).dot)} />
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
  if (g.goalId === "standup-brief-ready") {
    return [`standup time ${String(ev.standupTime ?? "09:30")}`, ev.awaitingApprovalBriefId ? "a brief is waiting in Approvals" : "", ev.publishedBriefId ? "today's brief is published" : ""].filter(Boolean);
  }
  if (g.goalId === "no-stuck-work") {
    const s = (ev.stuck as { key: string; reasons: { code: string; detail: string }[] }[]) ?? [];
    return s.map((x) => `${x.key} · ${x.reasons.map((r) => r.code).join(", ")} · ${x.reasons[0]?.detail ?? ""}`);
  }
  if (g.goalId === "sprint-on-track") return [String(ev.why ?? "").replace(/\s*\[sprint\]\s*$/, "")].filter(Boolean);
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
  const checkOnly = g.goalId === "sprint-on-track";
  return (
    <article
      className={cx("grid gap-6 rounded-xl border border-line bg-surface p-6 transition-colors md:grid-cols-[180px_1fr_170px]", changed && "status-changed")}
      style={{ ["--flash" as string]: flash }}
      aria-live="polite"
    >
      <div className={cx("border-l-4 pl-4", status === "green" ? "border-ok" : status === "red" ? "border-bad" : status === "amber" ? "border-warn" : "border-line")}>
        <div className="font-mono text-xs text-muted">{GOAL_SHORT[g.goalId] ?? g.goalId}</div>
        <h3 className="mt-1 text-base font-semibold leading-snug">{g.label.replace(/^[GS]\d · /, "")}</h3>
        <div className="mt-3">
          <GoalStatus status={status} large />
        </div>
        {changed && <p className="mt-2 text-xs font-medium" style={{ color: flash }}>Just changed from {goalTone(g.previousStatus ?? undefined).label.toLowerCase()}</p>}
      </div>
      <div className="min-w-0">
        {g.regressed && <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-warn-bg px-2.5 py-0.5 text-xs font-medium text-warn">Regression · an approved fix broke</p>}
        <p className="text-sm">{g.latest?.summary ?? "Not checked yet."}</p>
        {lines.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-lg bg-surface-2 px-3 py-2.5 font-mono text-xs text-muted">
            {lines.slice(0, 4).map((l, i) => (
              <li key={i} className="truncate" title={l}>{l}</li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>Checked {timeAgo(g.latest?.createdAt)}</span>
          <HistoryStrip history={g.history} />
        </div>
      </div>
      <div className="flex flex-col justify-between gap-4 md:items-end md:text-right">
        <div>
          <div className="text-2xl font-semibold tabular-nums">{hours(g.hoursBrokenWeek)}</div>
          <div className="text-xs text-muted">broken this week</div>
        </div>
        {checkOnly ? (
          <Link href="/sprint" className="text-sm font-medium text-accent hover:underline">View forecast →</Link>
        ) : openJob ? (
          <Link href={`/jobs/${openJob.id}`} className="flex flex-col gap-1 text-sm font-medium text-accent hover:underline md:items-end">
            <JobStatus status={openJob.status} />
            <span>View job →</span>
          </Link>
        ) : (
          <div className="flex flex-col gap-1 md:items-end">
            <Button
              variant={status === "red" ? "primary" : "secondary"}
              disabled={status === "green" || !status || killSwitch}
              busy={busy}
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
              {g.goalId === "standup-brief-ready" ? "Generate brief" : g.goalId === "no-stuck-work" ? "Draft nudges" : "Run job"}
            </Button>
            {err && <span className="max-w-[170px] text-xs text-bad">{err}</span>}
          </div>
        )}
      </div>
    </article>
  );
}

// ---------------- hero cards ----------------
function HeroCard({ tone, eyebrow, title, value, reason, href, action }: { tone: "green" | "amber" | "red" | "neutral"; eyebrow: string; title: string; value: ReactNode; reason: string; href: string; action: string }) {
  return (
    <Card className="flex flex-col p-5" interactive>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">{eyebrow}</span>
        <StatusPill tone={tone} dot>{tone === "green" ? "Healthy" : tone === "amber" ? "At risk" : tone === "red" ? "Needs attention" : "—"}</StatusPill>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-sm font-medium">{title}</div>
      <p className="mt-1 flex-1 text-xs text-muted">{reason}</p>
      <Link href={href} className="mt-3 text-sm font-medium text-accent hover:underline">{action} →</Link>
    </Card>
  );
}

interface AuditRow { id: string; action: string; target: string; createdAt: string; actor: string }
interface PendingJob { id: string; jobType: string; goalLabel: string; status: string }

const toneOf = (s?: string): "green" | "amber" | "red" | "neutral" => (s === "green" ? "green" : s === "amber" ? "amber" : s === "red" ? "red" : "neutral");

export default function OverviewPage() {
  const { data, error, refresh } = usePoll<Overview>("/api/overview", 2500);
  const { data: fc } = usePoll<{ forecast: Forecast | null }>("/api/forecast", 5000);
  const { data: audit } = usePoll<{ events: AuditRow[] }>("/api/audit", 5000);
  const { data: appr, refresh: refreshAppr } = usePoll<{ pending: PendingJob[] }>("/api/approvals", 3000);
  const [checking, setChecking] = useState(false);

  const tg = (id: string) => data?.teamGoals?.find((g) => g.goalId === id);
  const codeGreen = (data?.goals ?? []).filter((g) => g.latest?.status === "green").length;
  const codeTotal = (data?.goals ?? []).length;
  const s2 = tg("no-stuck-work");
  const stuckCount = ((s2?.latest?.evidence as { stuck?: unknown[] } | undefined)?.stuck ?? []).length;
  const today = new Date().toDateString();
  const todayEvents = (audit?.events ?? []).filter((e) => new Date(e.createdAt).toDateString() === today).slice(0, 8);

  return (
    <>
      <PageHeader
        title="Team health at a glance"
        subtitle="The same engine keeps the team's work healthy: standing goals in plain code, an AI worker that only words the facts, a different AI that verifies, a gate, and you."
        actions={
          <Button
            variant="secondary"
            busy={checking}
            onClick={async () => {
              setChecking(true);
              try {
                await post("/api/goals/check");
                await refresh();
              } finally {
                setChecking(false);
              }
            }}
          >
            {checking ? "Checking…" : "Check goals now"}
          </Button>
        }
      />
      <ErrorNote error={error} />
      {!data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <HeroCard eyebrow="S1 · Standup" tone={toneOf(tg("standup-brief-ready")?.latest?.status)} value={tg("standup-brief-ready")?.latest?.status === "green" ? "Published" : "Not yet"} title="Standup brief" reason={tg("standup-brief-ready")?.latest?.summary ?? ""} href="/standup" action="Open standup" />
            <HeroCard eyebrow="S2 · Flow" tone={toneOf(s2?.latest?.status)} value={`${stuckCount} stuck`} title="Stuck work" reason={s2?.latest?.summary ?? "No stuck items"} href="/sprint" action="Open board" />
            <Card className="flex flex-col p-5" interactive>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted">S3 · Forecast</span>
                <StatusPill tone={toneOf(tg("sprint-on-track")?.latest?.status)} dot>{tg("sprint-on-track")?.latest?.status === "green" ? "On track" : tg("sprint-on-track")?.latest?.status === "amber" ? "At risk" : "Off track"}</StatusPill>
              </div>
              {fc?.forecast ? <div className="mt-1"><Gauge probability={fc.forecast.probability} /></div> : <div className="mt-3 text-sm text-muted">No forecast yet</div>}
              <Link href="/sprint" className="mt-1 text-center text-sm font-medium text-accent hover:underline">See the forecast →</Link>
            </Card>
            <HeroCard eyebrow="Code health" tone={codeGreen === codeTotal ? "green" : "red"} value={`${codeGreen}/${codeTotal}`} title="Code goals green" reason="Dependency security, green build and working setup docs." href="/jobs" action="View code jobs" />
          </div>

          <Card className="mt-6 p-5">
            <MorningRoutine onDone={() => { refresh(); refreshAppr(); }} />
          </Card>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
            <Card className="p-5">
              <h2 className="text-sm font-semibold">Needs your decision</h2>
              <p className="mt-0.5 mb-3 text-xs text-muted">Nothing is sent or merged without you.</p>
              {(appr?.pending ?? []).length === 0 ? (
                <EmptyState title="All clear" hint="No approvals waiting. Run the morning routine to draft a brief and nudges." />
              ) : (
                <ul className="space-y-2">
                  {(appr?.pending ?? []).slice(0, 3).map((j) => (
                    <li key={j.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{j.goalLabel}</div>
                        <div className="text-xs text-muted">{j.jobType}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {j.jobType === "nudge-draft" ? (
                          <Link href="/approvals" className="text-sm font-medium text-accent hover:underline">Review →</Link>
                        ) : (
                          <Button
                            onClick={async () => {
                              try {
                                await post(`/api/jobs/${j.id}/approve`, {});
                                toast("Approved and published", "ok");
                                refreshAppr();
                                refresh();
                              } catch (e) {
                                toast((e as Error).message, "info");
                              }
                            }}
                          >
                            Approve
                          </Button>
                        )}
                        <Link href="/approvals" className="text-xs text-muted hover:text-fg">Open</Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-5">
              <h2 className="text-sm font-semibold">Today</h2>
              <p className="mt-0.5 mb-3 text-xs text-muted">What Autopilot did today.</p>
              {todayEvents.length === 0 ? (
                <EmptyState title="Quiet so far" hint="Actions show up here as Autopilot checks goals, drafts briefs and more." />
              ) : (
                <ul className="space-y-2.5">
                  {todayEvents.map((e) => (
                    <li key={e.id} className="flex items-start gap-2.5 text-sm">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                      <span className="min-w-0">
                        <span className="text-muted">{new Date(e.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · </span>
                        <span>{e.action.replace(/[._]/g, " ")}</span>
                        {e.target && <span className="text-muted"> — {e.target.length > 40 ? `${e.target.slice(0, 40)}…` : e.target}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <h2 className="mt-10 mb-3 text-sm font-semibold">Team health <span className="font-normal text-muted">· Scrum goals (pseudonymised sprint data)</span></h2>
          <div className="space-y-4">
            {(data.teamGoals ?? []).map((g) => (
              <GoalPanel key={g.goalId} g={g} killSwitch={data.killSwitch} openJob={data.openJobs.find((j) => j.goalId === g.goalId)} onRun={async () => { await post(`/api/goals/${g.goalId}/run`); await refresh(); }} />
            ))}
          </div>
          <h2 className="mt-10 mb-3 text-sm font-semibold">Code health</h2>
          <div className="space-y-4">
            {data.goals.map((g) => (
              <GoalPanel key={g.goalId} g={g} killSwitch={data.killSwitch} openJob={data.openJobs.find((j) => j.goalId === g.goalId)} onRun={async () => { await post(`/api/goals/${g.goalId}/run`); await refresh(); }} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
