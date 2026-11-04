"use client";
import { useState } from "react";
import { post } from "@/lib/usePoll";
import { Button, cx } from "./ui";

type Mode = null | "reject" | "changes";

export function ApprovalActions({ jobId, attempt, githubMode, onDone }: { jobId: string; attempt: number; githubMode?: boolean; onDone: () => void }) {
  const [mode, setMode] = useState<Mode>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function act(kind: "approve" | "reject" | "request-changes", payload: object) {
    setBusy(kind);
    setErr(null);
    try {
      const r = await post<{ status: string; trustChange?: { kind: string; from: number; to: number } | null }>(`/api/jobs/${jobId}/${kind}`, payload);
      setDone(
        kind === "approve"
          ? `${r.status === "merged" ? "Merged into main" : "Draft PR marked ready for review"}.${r.trustChange ? ` Trust ${r.trustChange.kind}: L${r.trustChange.from} → L${r.trustChange.to}.` : ""} Goals re-checked.`
          : kind === "reject"
            ? `Rejected.${r.trustChange ? ` Trust ${r.trustChange.kind}: L${r.trustChange.from} → L${r.trustChange.to}.` : ""}`
            : "Feedback sent. The worker is making one more attempt.",
      );
      setMode(null);
      setText("");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (done) return <p className="rounded-lg bg-ok-bg px-4 py-3 text-sm font-medium text-ok">{done}</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" busy={busy === "approve"} disabled={Boolean(busy)} onClick={() => act("approve", {})}>
          {githubMode ? "Approve and mark PR ready" : "Approve and merge"}
        </Button>
        <Button variant="secondary" disabled={Boolean(busy) || attempt >= 2} title={attempt >= 2 ? "Only one extra attempt is allowed" : undefined} onClick={() => setMode(mode === "changes" ? null : "changes")} aria-expanded={mode === "changes"}>
          Request changes
        </Button>
        <Button variant="danger" disabled={Boolean(busy)} onClick={() => setMode(mode === "reject" ? null : "reject")} aria-expanded={mode === "reject"}>
          Reject
        </Button>
      </div>
      {mode && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            act(mode === "reject" ? "reject" : "request-changes", mode === "reject" ? { reason: text } : { feedback: text });
          }}
        >
          <label htmlFor={`txt-${jobId}`} className="block text-sm font-medium">
            {mode === "reject" ? "Why are you rejecting this? (required)" : "What should the worker change? (one more attempt)"}
          </label>
          <textarea
            id={`txt-${jobId}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            required
            rows={3}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            placeholder={mode === "reject" ? "e.g. Quarantining hides a real timeout; fix the client instead." : "e.g. Also mention the renamed script in the changelog."}
          />
          <div className="flex gap-2">
            <Button type="submit" variant={mode === "reject" ? "danger" : "primary"} busy={Boolean(busy)} disabled={!text.trim()}>
              {mode === "reject" ? "Reject job" : "Send feedback to worker"}
            </Button>
            <Button variant="ghost" onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {err && <p className={cx("text-sm text-bad")}>{err}</p>}
    </div>
  );
}
