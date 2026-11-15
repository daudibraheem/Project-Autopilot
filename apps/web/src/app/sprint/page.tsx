"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { ReasonBadge, WorkerBadge } from "@/components/team";
import { cx, Empty, ErrorNote, Loading, Mono, PageHeader } from "@/components/ui";
import { dateTime, timeAgo } from "@/lib/format";
import { personName, restoreNames } from "@/lib/names";
import type { People } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";

interface Item {
  key: string;
  title: string;
  type: string;
  status: string;
  statusCategory: string;
  storyPoints: number | null;
  labels: string[];
  assigneeRef: string | null;
  lastActivityAt: string;
  linkedPrUrls: string[];
  linkedGoalId: string | null;
  isAgentWork: boolean;
  addedAfterSprintStart: boolean;
  stuckReasons: { code: string; detail: string }[];
  normalWaiting: boolean;
  job: { id: string; jobType: string; status: string; trust?: { level: number; label: string } } | null;
  events: { id: string; kind: string; at: string; actorRef: string | null; fromValue: string | null; toValue: string | null; body: string | null; flagged: boolean }[];
}

interface SprintData {
  sprint: { id: string; name: string; goal: string; start: string; end: string; provider: string } | null;
  items: Item[];
  people: People;
  settings: { normalWaitingStatuses: string[]; stuckThresholdDays: number };
  redGoals: string[];
}

const GROUPS: { cat: string; label: string }[] = [
  { cat: "todo", label: "To do" },
  { cat: "in_progress", label: "In progress" },
  { cat: "done", label: "Done" },
];

function ItemCard({ it, people, focused, focusEvent }: { it: Item; people: People; focused: boolean; focusEvent: string | null }) {
  const stuck = it.stuckReasons.length > 0;
  return (
    <li
      id={it.key}
      className={cx(
        "scroll-mt-24 rounded-lg border p-3.5 transition-shadow",
        stuck ? "border-bad/50 bg-bad-bg/50" : "border-line bg-surface",
        focused && "ring-2 ring-accent",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Mono className="font-semibold">{it.key}</Mono>
        <WorkerBadge agent={it.isAgentWork} />
        <span className="text-xs text-muted">{it.status}</span>
        {it.addedAfterSprintStart && <span className="rounded-full bg-warn-bg px-2 py-0.5 text-xs font-medium text-warn">Added mid-sprint</span>}
        {it.normalWaiting && <span className="rounded-full bg-ok-bg px-2 py-0.5 text-xs font-medium text-ok">Normal wait, not stuck</span>}
      </div>
      <p className="mt-1.5 text-sm font-medium">{restoreNames(it.title, people)}</p>
      {stuck && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {it.stuckReasons.map((r) => (
            <ReasonBadge key={r.code} code={r.code} detail={r.detail} />
          ))}
        </div>
      )}
      {stuck && <p className="mt-1 text-xs text-bad">{it.stuckReasons.map((r) => r.detail).join(" · ")}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {!it.isAgentWork && <span>{personName(it.assigneeRef, people)}</span>}
        <span>Last activity {timeAgo(it.lastActivityAt)}</span>
        {it.storyPoints !== null && <span>{it.storyPoints} pts</span>}
        {it.linkedGoalId && <span>Linked to Autopilot goal {it.linkedGoalId}</span>}
        {it.linkedPrUrls.map((u) => (
          <a key={u} href={u} className="text-accent hover:underline" target="_blank" rel="noreferrer">
            PR #{u.split("/").pop()}
          </a>
        ))}
      </div>
      {it.job && (
        <p className="mt-2 text-xs">
          Done by{" "}
          <Link href={`/jobs/${it.job.id}`} className="font-mono text-accent hover:underline">
            {it.job.id}
          </Link>{" "}
          · {it.job.jobType} · {it.job.status}
          {it.job.trust && <span className="text-muted"> · trust {it.job.trust.label}</span>}
        </p>
      )}
      {(focused || focusEvent) && it.events.length > 0 && (
        <ol className="mt-3 space-y-1 border-t border-line pt-2 text-xs">
          {it.events.map((e) => (
            <li key={e.id} id={e.id} className={cx("rounded px-1.5 py-1", focusEvent === e.id && "bg-accent/10 ring-1 ring-accent", e.flagged && "bg-warn-bg")}>
              <span className="text-muted">{dateTime(e.at)}</span> · <Mono>{e.id}</Mono> ·{" "}
              {e.kind === "status_change" ? `${e.fromValue} → ${e.toValue}` : e.kind === "comment" ? restoreNames(e.body ?? "", people) : e.kind.replace("_", " ")}
              {e.actorRef && <span className="text-muted"> ({personName(e.actorRef, people)})</span>}
              {e.flagged && <strong className="ml-1 text-warn">Flagged: treated as data, ignored</strong>}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function SprintInner() {
  const params = useSearchParams();
  const focus = params.get("item");
  const focusEvent = params.get("event");
  const { data, error } = usePoll<SprintData>("/api/sprint", 5000);
  useEffect(() => {
    if (focus && data) document.getElementById(focus)?.scrollIntoView({ block: "center" });
  }, [focus, data]);
  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  if (!data.sprint)
    return (
      <Empty>
        No active sprint. Run <Mono>pnpm cli seed-sprint</Mono> (mock) or <Mono>pnpm cli sync-sprint</Mono> (Jira).
      </Empty>
    );
  const stuck = data.items.filter((i) => i.stuckReasons.length);
  return (
    <>
      <PageHeader
        title={data.sprint.name}
        subtitle={
          <>
            <strong className="font-medium text-fg">Goal:</strong> {data.sprint.goal} · {data.sprint.start.slice(0, 10)} → {data.sprint.end.slice(0, 10)} · source: {data.sprint.provider}
            <br />
            Stuck = in progress with no activity for more than {data.settings.stuckThresholdDays} days, a PR waiting over 24 h for review, a red linked Autopilot goal, or a blocked label.
            Normal waits ({data.settings.normalWaitingStatuses.join(", ")}) are never stuck. Detected by plain code.
          </>
        }
      />
      <dl className="mb-8 grid grid-cols-2 gap-x-8 gap-y-4 border-y border-line py-5 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">Items</dt>
          <dd className="text-xl font-semibold tabular-nums">{data.items.length}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Stuck</dt>
          <dd className={cx("text-xl font-semibold tabular-nums", stuck.length > 0 && "text-bad")}>{stuck.length}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Added mid-sprint</dt>
          <dd className="text-xl font-semibold tabular-nums">{data.items.filter((i) => i.addedAfterSprintStart).length}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Autopilot agent work</dt>
          <dd className="text-xl font-semibold tabular-nums">{data.items.filter((i) => i.isAgentWork).length}</dd>
        </div>
      </dl>
      <div className="grid gap-6 lg:grid-cols-3">
        {GROUPS.map((g) => {
          const items = data.items.filter((i) => i.statusCategory === g.cat).sort((a, b) => b.stuckReasons.length - a.stuckReasons.length);
          return (
            <section key={g.cat} aria-labelledby={`col-${g.cat}`}>
              <h2 id={`col-${g.cat}`} className="mb-3 flex items-baseline justify-between text-sm font-semibold">
                {g.label} <span className="text-xs font-normal text-muted">{items.length}</span>
              </h2>
              <ul className="space-y-2.5">
                {items.map((it) => (
                  <ItemCard key={it.key} it={it} people={data.people} focused={focus === it.key} focusEvent={focus === it.key ? focusEvent : null} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

export default function SprintPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SprintInner />
    </Suspense>
  );
}
