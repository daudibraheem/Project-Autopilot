"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { ForecastPanel } from "@/components/forecast";
import { Avatar, Badge, Card, Skeleton, StatusPill, toast } from "@/components/kit";
import { ReasonBadge } from "@/components/team";
import { Button, cx, ErrorNote, Mono, PageHeader } from "@/components/ui";
import { personName } from "@/lib/names";
import type { Forecast, People } from "@/lib/types";
import { post, usePoll } from "@/lib/usePoll";

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
  isAgentWork: boolean;
  addedAfterSprintStart: boolean;
  stuckReasons: { code: string; detail: string }[];
  normalWaiting: boolean;
  job: { id: string; jobType: string; status: string; trust?: { level: number; label: string } } | null;
}
interface SprintData {
  sprint: { name: string; goal: string } | null;
  items: Item[];
  people: People;
}

const COLUMNS = [
  { id: "todo", label: "To do" },
  { id: "in_progress", label: "In progress" },
  { id: "in_review", label: "In review" },
  { id: "done", label: "Done" },
];
function columnOf(i: Item): string {
  if (i.statusCategory === "done") return "done";
  if (/review/i.test(i.status)) return "in_review";
  if (i.statusCategory === "in_progress") return "in_progress";
  return "todo";
}

type Filter = "all" | "stuck" | "agent" | "added";

function Flag({ item }: { item: Item }) {
  return (
    <details className="group relative mt-2">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-bad hover:underline">Why is this flagged?</summary>
      <div className="absolute left-0 z-10 mt-1 w-64 rounded-lg border border-line bg-surface p-3 text-xs shadow-lg">
        {item.stuckReasons.map((r) => (
          <div key={r.code} className="mb-2 last:mb-0">
            <ReasonBadge code={r.code} />
            <p className="mt-1 text-muted">{r.detail}</p>
          </div>
        ))}
        <div className="mt-2 border-t border-line pt-2 text-muted">
          Source: <Link href={`/sprint#${item.key}`} className="text-accent hover:underline">{item.key}</Link>
          {item.job && <> · <Link href={`/jobs/${item.job.id}`} className="text-accent hover:underline">{item.job.id}</Link></>}
        </div>
      </div>
    </details>
  );
}

function ItemCard({ item, people }: { item: Item; people: People }) {
  const stuck = item.stuckReasons.length > 0;
  return (
    <Card id={item.key} className={cx("p-3", stuck && "border-l-[3px] border-l-bad")}>
      <div className="flex items-start justify-between gap-2">
        <Mono className="text-xs text-muted">{item.key}</Mono>
        <div className="flex items-center gap-1.5">
          {item.storyPoints != null && <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">{item.storyPoints}</span>}
          <Badge kind={item.isAgentWork ? "agent" : "human"} />
        </div>
      </div>
      <p className="mt-1.5 text-sm font-medium leading-snug">{item.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <Avatar name={personName(item.assigneeRef, people)} size={18} /> {personName(item.assigneeRef, people)}
        </span>
        {item.addedAfterSprintStart && <StatusPill tone="amber">Added mid-sprint</StatusPill>}
        {item.normalWaiting && <span className="text-[11px] text-muted" title="Normal wait, not stuck">Normal wait</span>}
      </div>
      {item.job && (
        <Link href={`/jobs/${item.job.id}`} className="mt-2 block text-[11px] text-accent hover:underline">
          Autopilot {item.job.trust ? `· ${item.job.trust.label}` : ""} →
        </Link>
      )}
      {stuck && <Flag item={item} />}
    </Card>
  );
}

function Board() {
  const { data, error, refresh } = usePoll<SprintData>("/api/sprint", 3000);
  const { data: fc, refresh: refreshFc } = usePoll<{ forecast: Forecast | null }>("/api/forecast", 5000);
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  if (error && !data) return <ErrorNote error={error} />;
  const items = (data?.items ?? []).filter((i) => (filter === "all" ? true : filter === "stuck" ? i.stuckReasons.length > 0 : filter === "agent" ? i.isAgentWork : i.addedAfterSprintStart));
  const f = fc?.forecast;
  const pct = f ? Math.round((f.completedPoints / Math.max(1, f.totalPoints)) * 100) : 0;

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "stuck", label: "Stuck" },
    { id: "agent", label: "AI agent" },
    { id: "added", label: "Added mid-sprint" },
  ];

  return (
    <>
      <PageHeader
        title="Sprint board"
        subtitle="Humans and AI agents on one board. Stuck work is detected by plain code; people appear by name here (UI only — the model only ever saw pseudonyms)."
        actions={
          <Button
            variant="secondary"
            busy={adding}
            onClick={async () => {
              setAdding(true);
              try {
                const r = await post<{ key: string; points: number; forecastPct: number | null; droppedBy?: number }>("/api/sprint/add-item", {});
                setBanner(`Scope changed — 1 item added (${r.key}, ${r.points} pts)${r.droppedBy != null ? `, forecast dropped ${r.droppedBy} points` : ""}.`);
                toast("Scope changed — forecast updated", "info");
                await refresh();
                await refreshFc();
              } catch (e) {
                toast((e as Error).message, "info");
              } finally {
                setAdding(false);
              }
            }}
          >
            + Add mid-sprint item
          </Button>
        }
      />

      {banner && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-warn/30 bg-warn-bg px-4 py-2.5 text-sm text-warn animate-in">
          <span>{banner}</span>
          <button type="button" onClick={() => setBanner(null)} className="text-warn/70 hover:text-warn" aria-label="Dismiss">✕</button>
        </div>
      )}

      {!data ? (
        <Skeleton className="h-96" />
      ) : !data.sprint ? (
        <ErrorNote error="No active sprint. Run `pnpm cli seed-sprint`." />
      ) : (
        <>
          <div className="mb-6 grid gap-5 lg:grid-cols-[1fr_320px]">
            <Card className="p-5">
              <div className="text-xs font-medium text-muted">Sprint goal</div>
              <p className="mt-1 text-sm font-medium">{data.sprint.goal}</p>
              <div className="mt-4 flex items-center justify-between text-xs text-muted">
                <span>Progress</span>
                <span className="tabular-nums">{f ? `${f.completedPoints} / ${f.totalPoints} pts` : ""}</span>
              </div>
              <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-ok transition-[width] duration-500" style={{ width: `${pct}%` }} />
              </div>
            </Card>
            {f && (
              <div data-presenter="forecast">
                <ForecastPanel forecast={f} compact />
              </div>
            )}
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-1 rounded-lg border border-line bg-surface-2 p-1">
            {filters.map((ff) => (
              <button key={ff.id} type="button" onClick={() => setFilter(ff.id)} className={cx("rounded-md px-3 py-1 text-xs font-medium", filter === ff.id ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg")}>
                {ff.label}
              </button>
            ))}
            <span className="ml-auto px-2 text-xs text-muted">{items.length} item(s)</span>
          </div>

          <div data-presenter="board" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {COLUMNS.map((col) => {
              const colItems = items.filter((i) => columnOf(i) === col.id);
              return (
                <div key={col.id} className="rounded-xl bg-surface-2/50 p-2">
                  <div className="flex items-center justify-between px-2 py-1.5 text-xs font-semibold">
                    <span>{col.label}</span>
                    <span className="text-muted tabular-nums">{colItems.length}</span>
                  </div>
                  <div className="space-y-2">
                    {colItems.map((i) => (
                      <ItemCard key={i.key} item={i} people={data.people} />
                    ))}
                    {colItems.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted">—</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

export default function SprintPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Board />
    </Suspense>
  );
}
