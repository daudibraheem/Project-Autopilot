"use client";
import { useState } from "react";
import { clock, ms, usd } from "@/lib/format";
import type { Evidence, JobDetail, Step } from "@/lib/types";
import { Check, cx, Empty, Mono } from "./ui";

/** Small custom unified-diff renderer (monospace, add/remove tinted). */
export function Diff({ diff }: { diff: string | null }) {
  if (!diff) return <Empty>No diff yet.</Empty>;
  const files = diff.split(/^(?=diff --git )/m).filter((f) => f.trim());
  return (
    <div className="space-y-4">
      {files.map((f, i) => {
        const name = /^diff --git a\/(\S+)/.exec(f)?.[1] ?? "file";
        const lines = f.split("\n").filter((l) => !/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode)/.test(l));
        return (
          <div key={i} className="overflow-hidden rounded-lg border border-line">
            <div className="border-b border-line bg-surface-2 px-3 py-1.5 font-mono text-xs font-medium">{name}</div>
            <pre className="overflow-x-auto text-xs leading-5">
              {lines.map((l, j) => (
                <div
                  key={j}
                  className={cx(
                    "px-3 font-mono whitespace-pre",
                    l.startsWith("+") && "bg-add",
                    l.startsWith("-") && "bg-del",
                    l.startsWith("@@") && "bg-surface-2 text-muted",
                  )}
                >
                  {l || " "}
                </div>
              ))}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

const PHASE_LABEL: Record<string, string> = {
  worker: "Worker",
  classifier: "Classifier",
  verifier: "Verifier",
  gate: "Gate",
  lesson: "Lesson",
  system: "Harness",
  approval: "Approval",
};

function stepTitle(s: Step): string {
  if (s.kind === "llm") return s.phase === "worker" ? (s.inputSummary === "(final answer)" ? "Final answer" : "Plan → tool call") : `${PHASE_LABEL[s.phase] ?? s.phase} model call`;
  if (s.kind === "tool") return s.tool ?? "tool";
  return PHASE_LABEL[s.phase] ?? s.phase;
}

export function Timeline({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (steps.length === 0) return <Empty>No steps yet. The worker picks the job up within a few seconds.</Empty>;
  return (
    <ol className="relative space-y-1">
      {steps.map((s) => {
        const isOpen = open[s.id] ?? (s.status === "denied" || (s.kind === "note" && s.phase === "gate"));
        return (
          <li key={s.id} className={cx("rounded-lg border", s.status === "denied" ? "border-bad/40 bg-bad-bg/60" : s.status === "error" ? "border-warn/40" : "border-transparent hover:border-line")}>
            <button type="button" className="flex w-full items-start gap-3 px-3 py-2 text-left" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [s.id]: !isOpen })}>
              <span className="w-7 shrink-0 pt-0.5 text-right font-mono text-xs text-muted">{s.index}</span>
              <span
                className={cx(
                  "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                  s.status === "denied" ? "bg-bad" : s.status === "error" ? "bg-warn" : s.kind === "llm" ? "bg-accent" : s.kind === "tool" ? "bg-ok" : "bg-muted",
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  {s.kind !== "note" && <span className="text-xs text-muted">{PHASE_LABEL[s.phase] ?? s.phase}</span>}
                  <span className="text-sm font-medium">{stepTitle(s)}</span>
                  {s.status === "denied" && <span className="text-xs font-semibold text-bad">Denied by policy</span>}
                  {s.attempt > 1 && <span className="text-xs text-muted">attempt {s.attempt}</span>}
                </span>
                {!isOpen && s.inputSummary && s.kind !== "note" && <span className="block truncate font-mono text-xs text-muted">{s.inputSummary}</span>}
                {!isOpen && s.kind === "note" && <span className="block truncate text-xs text-muted">{s.outputSummary}</span>}
              </span>
              <span className="hidden shrink-0 text-right text-xs text-muted sm:block">
                {s.model && <span className="block font-mono">{s.model}</span>}
                <span className="tabular-nums">
                  {s.kind === "llm" ? `${s.tokensIn + s.tokensOut} tok · ${usd(s.costUsd)} · ` : ""}
                  {ms(s.durationMs)}
                </span>
              </span>
            </button>
            {isOpen && (
              <div className="space-y-2 px-3 pb-3 pl-[3.25rem]">
                {s.inputSummary && s.kind !== "note" && <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-surface-2 p-2.5 font-mono text-xs">{s.inputSummary}</pre>}
                {s.outputSummary && <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-2.5 font-mono text-xs text-muted">{s.outputSummary}</pre>}
                <p className="text-xs text-muted">
                  {clock(s.createdAt)}
                  {s.provider && ` · ${s.provider}`}
                  {s.hasCheckpoint && " · checkpoint saved"}
                </p>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function GateChecklist({ results }: { results: JobDetail["gateResults"] }) {
  if (results.length === 0) return <Empty>The gate has not run yet.</Empty>;
  return (
    <ul className="divide-y divide-line">
      {results.map((g) => (
        <li key={g.id} className="flex gap-3 py-2.5">
          <Check ok={g.passed} />
          <div className="min-w-0">
            <div className="text-sm font-medium">{g.label}</div>
            <div className="break-words text-xs text-muted">{g.evidence}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function VerifierView({ report }: { report?: JobDetail["verifierReports"][number] }) {
  if (!report) return <Empty>The verifier has not run yet.</Empty>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={cx("rounded-full px-3 py-1 text-sm font-semibold", report.verdict === "pass" ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad")}>
          Verdict: {report.verdict}
        </span>
        <span className="text-xs text-muted">
          <Mono>{report.model}</Mono> via {report.provider} · saw contract, diff, evidence and explanation only
        </span>
      </div>
      <ul className="space-y-2">
        {report.checks.map((c) => (
          <li key={c.name} className="flex gap-3">
            <Check ok={c.passed} />
            <div>
              <div className="font-mono text-xs">{c.name}</div>
              <div className="text-sm text-muted">{c.reason}</div>
            </div>
          </li>
        ))}
      </ul>
      {report.concerns.length > 0 && (
        <div className="rounded-lg bg-warn-bg px-4 py-3 text-sm text-warn">
          <div className="font-medium">Concerns</div>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {report.concerns.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ContractView({ c }: { c: JobDetail["contract"] }) {
  if (!c) return null;
  return (
    <dl className="space-y-3 text-sm">
      <div>
        <dt className="text-xs text-muted">Allowed paths</dt>
        <dd className="mt-1 flex flex-wrap gap-1.5">
          {c.allowedPaths.map((p) => (
            <Mono key={p} className="rounded bg-ok-bg px-1.5 py-0.5 text-ok">
              {p}
            </Mono>
          ))}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted">Forbidden (includes high-risk paths)</dt>
        <dd className="mt-1 flex flex-wrap gap-1">
          {c.forbiddenPaths.map((p) => (
            <Mono key={p} className="rounded bg-surface-2 px-1.5 py-0.5 text-muted">
              {p}
            </Mono>
          ))}
        </dd>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-xs text-muted">Budget</dt>
          <dd className="tabular-nums">
            {c.maxSteps} steps · {(c.maxTokens / 1000).toFixed(0)}k tokens
            <br />${c.maxUsd} · {c.maxMinutes} min
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Difficulty · risk</dt>
          <dd>
            {c.difficulty} · {c.riskLevel}
            <br />
            <span className="text-xs text-muted">{c.allowRegistry ? "registry allowed" : "no network"}</span>
          </dd>
        </div>
      </div>
      <div>
        <dt className="text-xs text-muted">Done criteria (machine-checkable)</dt>
        <dd>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {c.doneCriteria.map((d) => (
              <li key={d.description}>{d.description}</li>
            ))}
          </ul>
        </dd>
      </div>
    </dl>
  );
}

const EV_LABEL: Record<string, string> = {
  tests: "Tests",
  command: "Command",
  policy_denial: "Policy denial",
  injection_flag: "Injection flagged",
  write: "File written",
  classifier: "Classifier",
  rerun: "Re-run",
  git: "Git",
};

export function EvidenceList({ evidence }: { evidence: Evidence[] | null }) {
  if (!evidence?.length) return <Empty>No evidence recorded yet.</Empty>;
  return (
    <ul className="space-y-2">
      {evidence.map((e, i) => (
        <li
          key={i}
          className={cx(
            "rounded-lg border px-3 py-2",
            e.kind === "policy_denial" ? "border-bad/40 bg-bad-bg/60" : e.kind === "injection_flag" ? "border-warn/40 bg-warn-bg/60" : "border-line",
          )}
        >
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-medium">{EV_LABEL[e.kind] ?? e.kind}</span>
            {e.command && <Mono className="text-muted">{e.command.length > 90 ? `${e.command.slice(0, 90)}…` : e.command}</Mono>}
            {e.target && !e.command && <Mono className="text-muted">{e.target}</Mono>}
            {e.exitCode !== undefined && e.exitCode >= 0 && <span className={cx("text-xs font-medium", e.exitCode === 0 ? "text-ok" : "text-bad")}>exit {e.exitCode}</span>}
            {e.kind === "tests" && (
              <span className="text-xs text-muted">
                {e.newFailures} new failure(s){e.preExistingFailures ? `, ${e.preExistingFailures} pre-existing` : ""}
                {e.afterLastWrite ? " · after last edit" : ""}
              </span>
            )}
            {e.rule && <span className="text-xs font-semibold text-bad">{e.rule}</span>}
          </div>
          {(e.note || e.output) && <p className="mt-1 break-words font-mono text-xs text-muted">{e.note ?? e.output}</p>}
        </li>
      ))}
    </ul>
  );
}
