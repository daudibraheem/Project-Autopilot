"use client";
import { Card, Skeleton, StatusPill } from "@/components/kit";
import { ErrorNote, Mono, PageHeader, cx } from "@/components/ui";
import { usd } from "@/lib/format";
import { usePoll } from "@/lib/usePoll";

interface Agent {
  jobType: string;
  label: string;
  team: "team" | "code";
  trust: { level: number; label: string; cap?: number; autoMergeAllowed: boolean };
  runs: number;
  approvals: number;
  rejections: number;
  gateFailures: number;
  approvalRate: number | null;
  costSprint: number;
  last5: { id: string; ok: boolean; status: string }[];
  cappedForever: boolean;
}

function TrustMeter({ level, cap }: { level: number; cap?: number }) {
  return (
    <div className="flex items-center gap-1.5" title={`Trust level L${level}${cap === 0 ? " (capped at L0)" : ""}`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={cx("h-1.5 w-8 rounded-full", i <= level ? "bg-accent" : "bg-surface-2", cap !== undefined && i > cap && "opacity-40")} />
      ))}
      <span className="ml-1 text-xs font-medium">L{level}</span>
    </div>
  );
}

function AgentCard({ a }: { a: Agent }) {
  return (
    <Card className="p-5" interactive>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-[color-mix(in_oklab,var(--accent),#a855f7_55%)]">✦</span>
            <h2 className="text-sm font-semibold">{a.label}</h2>
          </div>
          <Mono className="text-xs text-muted">{a.jobType}</Mono>
        </div>
        <StatusPill tone={a.team === "team" ? "accent" : "neutral"}>{a.team === "team" ? "Team" : "Code"}</StatusPill>
      </div>

      <div className="mt-4">
        <TrustMeter level={a.trust.level} cap={a.trust.cap} />
        {a.cappedForever && (
          <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-muted">
            <span aria-hidden>🔒</span> Always needs a human (by design).
          </p>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
        <div>
          <dt className="text-xs text-muted">Jobs run</dt>
          <dd className="text-lg font-semibold tabular-nums">{a.runs}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Approval rate</dt>
          <dd className="text-lg font-semibold tabular-nums">{a.approvalRate === null ? "—" : `${Math.round(a.approvalRate * 100)}%`}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Cost</dt>
          <dd className="text-lg font-semibold tabular-nums">{usd(a.costSprint, 2)}</dd>
        </div>
      </dl>

      <div className="mt-4">
        <div className="mb-1.5 text-xs text-muted">Last 5 results</div>
        <div className="flex gap-1.5">
          {a.last5.length === 0 && <span className="text-xs text-muted">No runs yet</span>}
          {a.last5.map((r) => (
            <span key={r.id} className={cx("h-2.5 w-2.5 rounded-full", r.ok ? "bg-ok" : "bg-bad")} title={`${r.id}: ${r.status}`} />
          ))}
        </div>
      </div>
    </Card>
  );
}

export default function AgentsPage() {
  const { data, error } = usePoll<{ agents: Agent[] }>("/api/agents", 4000);
  return (
    <>
      <PageHeader title="Your AI teammates" subtitle="Each job type is an AI agent that earns trust as its work is approved. Plain code (the gate) always has the final say, and some agents always need a human." />
      <ErrorNote error={error} />
      {!data ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {data.agents.map((a) => (
            <AgentCard key={a.jobType} a={a} />
          ))}
        </div>
      )}
    </>
  );
}
