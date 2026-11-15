"use client";
import Link from "next/link";
import { useState } from "react";
import { restoreNames } from "@/lib/names";
import type { BriefContent, Nudge, People } from "@/lib/types";
import { post } from "@/lib/usePoll";
import { Button, cx } from "./ui";

/** Where a source id points: item → sprint page, event → sprint page (highlighted), job → job page. */
export function sourceHref(id: string): string {
  if (id === "sprint") return "/sprint";
  if (/^j-[a-z0-9-]+$/.test(id)) return `/jobs/${id}`;
  if (/^[A-Z][A-Z0-9]+-\d+$/.test(id)) return `/sprint?item=${id}#${id}`;
  const key = /^([A-Z][A-Z0-9]+-\d+)-/.exec(id)?.[1];
  return key ? `/sprint?item=${key}&event=${encodeURIComponent(id)}#${key}` : "/sprint";
}

export function SourceChip({ id }: { id: string }) {
  const kind = id === "sprint" ? "sprint" : /^j-/.test(id) ? "job" : /^[A-Z][A-Z0-9]+-\d+$/.test(id) ? "item" : "event";
  return (
    <Link
      href={sourceHref(id)}
      title={`Open ${kind} ${id}`}
      className={cx(
        "inline-flex items-center rounded-md border px-1.5 py-px align-baseline font-mono text-[11px] font-medium no-underline transition-colors",
        kind === "job" ? "border-accent/30 bg-accent/10 text-accent hover:bg-accent/20" : "border-line bg-surface-2 text-muted hover:text-fg",
      )}
    >
      {id}
    </Link>
  );
}

export function BriefView({ content, people }: { content: BriefContent; people: People }) {
  return (
    <div className="space-y-5">
      {content.sections.map((s) => (
        <section key={s.title}>
          <h3 className="mb-2 text-sm font-semibold">{s.title}</h3>
          <ul className="space-y-2">
            {s.sentences.map((x, i) => (
              <li key={i} className="text-sm leading-relaxed">
                {restoreNames(x.text, people)}{" "}
                <span className="inline-flex flex-wrap gap-1 align-baseline">
                  {x.sources.length ? x.sources.map((src) => <SourceChip key={src} id={src} />) : <span className="text-xs font-semibold text-bad">no source</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function Counts({ counts, label }: { counts: BriefContent["counts"]; label?: string }) {
  const rows: [string, number][] = [
    ["Done", counts.done],
    ["In progress", counts.inProgress],
    ["Stuck", counts.stuck],
    ["Added mid-sprint", counts.addedMidSprint],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-muted">{k}</dt>
          <dd className={cx("text-xl font-semibold tabular-nums", k === "Stuck" && v > 0 && "text-bad")}>{v}</dd>
        </div>
      ))}
      {label && <p className="col-span-full text-xs text-muted">{label}</p>}
    </dl>
  );
}

const REASON: Record<string, string> = {
  no_activity: "No activity",
  review_waiting: "Review waiting",
  blocked_by_build: "Blocked by build",
  blocked_label: "Labelled blocked",
};

export function ReasonBadge({ code, detail }: { code: string; detail?: string }) {
  return (
    <span title={detail} className="inline-flex items-center gap-1 rounded-full bg-bad-bg px-2 py-0.5 text-xs font-medium text-bad">
      {REASON[code] ?? code}
      <span className="font-mono text-[10px] opacity-70">{code}</span>
    </span>
  );
}

export function WorkerBadge({ agent }: { agent: boolean }) {
  return agent ? (
    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">Autopilot agent</span>
  ) : (
    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">Human</span>
  );
}

/** One nudge draft: Approve (→ ready to copy, nothing is sent), Edit, Discard (reason required). */
export function NudgeCard({ n, people, onDone }: { n: Nudge; people: People; onDone: () => void }) {
  const [mode, setMode] = useState<null | "edit" | "discard">(null);
  const [text, setText] = useState(n.editedText ?? n.text);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const current = restoreNames(n.editedText ?? n.text, people);

  async function act(path: string, payload: object) {
    setBusy(true);
    setErr(null);
    try {
      await post(`/api/nudges/${n.id}/${path}`, payload);
      setMode(null);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cx("rounded-lg border p-4", n.status === "ready_to_send" ? "border-ok/40 bg-ok-bg/40" : n.status === "discarded" ? "border-line opacity-70" : "border-line bg-surface")}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SourceChip id={n.itemKey} />
        <ReasonBadge code={n.reasonCode} />
        <span className="ml-auto text-xs text-muted">
          {n.status === "ready_to_send" ? "Ready to send · not sent" : n.status === "discarded" ? `Discarded: ${n.discardReason}` : n.status === "awaiting_approval" ? "Draft" : n.status}
          {n.editedText && " · edited"}
        </span>
      </div>
      {mode === "edit" ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            act("edit", { text });
          }}
        >
          <label htmlFor={`edit-${n.id}`} className="sr-only">
            Edit nudge text
          </label>
          <textarea id={`edit-${n.id}`} value={text} onChange={(e) => setText(e.target.value)} rows={3} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" busy={busy}>
              Save draft
            </Button>
            <Button variant="ghost" onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-sm leading-relaxed">{current}</p>
      )}
      {mode === "discard" && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) act("discard", { reason });
          }}
        >
          <label htmlFor={`discard-${n.id}`} className="block text-sm font-medium">
            Why discard this draft? (required)
          </label>
          <input id={`discard-${n.id}`} value={reason} onChange={(e) => setReason(e.target.value)} required className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" placeholder="e.g. Already discussed in standup" />
          <div className="flex gap-2">
            <Button type="submit" variant="danger" busy={busy} disabled={!reason.trim()}>
              Discard draft
            </Button>
            <Button variant="ghost" onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {n.status === "awaiting_approval" && !mode && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" busy={busy} onClick={() => act("approve", {})}>
            Approve draft
          </Button>
          <Button onClick={() => setMode("edit")}>Edit</Button>
          <Button variant="danger" onClick={() => setMode("discard")}>
            Discard
          </Button>
        </div>
      )}
      {n.status === "ready_to_send" && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(current);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                setErr("Copy failed; select the text and copy it manually.");
              }
            }}
          >
            {copied ? "Copied" : "Copy text"}
          </Button>
          <span className="text-xs text-muted">Autopilot never sends messages. Paste it where your team talks.</span>
        </div>
      )}
      {err && <p className="mt-2 text-sm text-bad">{err}</p>}
    </div>
  );
}
