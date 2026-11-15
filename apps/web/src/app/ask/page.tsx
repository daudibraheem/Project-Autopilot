"use client";
import { useState } from "react";
import { SourceChip } from "@/components/team";
import { Button, Check, ErrorNote, Mono, PageHeader, Section } from "@/components/ui";
import { usd } from "@/lib/format";
import { restoreNames } from "@/lib/names";
import type { People } from "@/lib/types";
import { post } from "@/lib/usePoll";

interface AskResult {
  answer: string;
  citations: { id: string; kind: string; exists: boolean }[];
  checks: { name: string; passed: boolean; detail: string }[];
  costUsd: number;
  steps: number;
  model: string;
  toolCalls: string[];
  people: People;
}

const SUGGESTIONS = ["What's stuck and why?", "How is the sprint going?"];

/** Render "[PAY-142]" citations as clickable chips. */
function Answer({ text, people }: { text: string; people: People }) {
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {restoreNames(text, people)
        .split("\n")
        .map((line, i) => (
          <p key={i}>
            {line.split(/(\[[^\]]+\])/g).map((part, j) =>
              /^\[[^\]]+\]$/.test(part) ? (
                <span key={j} className="mx-0.5 inline-flex gap-1 align-baseline">
                  {part
                    .slice(1, -1)
                    .split(/,\s*/)
                    .map((id) => (
                      <SourceChip key={id} id={id} />
                    ))}
                </span>
              ) : (
                <span key={j}>{part}</span>
              ),
            )}
          </p>
        ))}
    </div>
  );
}

export default function AskPage() {
  const [q, setQ] = useState(SUGGESTIONS[0]!);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [r, setR] = useState<AskResult | null>(null);
  async function ask(question: string) {
    setBusy(true);
    setErr(null);
    try {
      setR(await post<AskResult>("/api/ask", { question }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Ask Autopilot"
        subtitle={
          <>
            Sprint questions answered with the read-only MCP tools <Mono>get_sprint</Mono>, <Mono>list_work_items</Mono> and <Mono>get_item_events</Mono>. The model sees pseudonyms only. Every
            answer must cite its sources, checked in plain code.
          </>
        }
      />
      <form
        className="mb-6 flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) ask(q);
        }}
      >
        <label htmlFor="ask-q" className="sr-only">
          Question
        </label>
        <input id="ask-q" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3.5 py-2 text-sm" maxLength={500} />
        <Button type="submit" variant="primary" busy={busy}>
          Ask
        </Button>
      </form>
      <div className="mb-6 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setQ(s);
              ask(s);
            }}
            className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted hover:text-fg"
          >
            {s}
          </button>
        ))}
      </div>
      <ErrorNote error={err} />
      {r && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <Section title="Answer" aside={`${r.model} · ${r.steps} steps · ${usd(r.costUsd)}`}>
            <Answer text={r.answer} people={r.people} />
          </Section>
          <div className="space-y-6">
            <Section title="Checks" aside="plain code">
              <ul className="space-y-2">
                {r.checks.map((c) => (
                  <li key={c.name} className="flex gap-2 text-sm">
                    <Check ok={c.passed} />
                    <span>
                      <Mono>{c.name}</Mono>
                      <span className="block text-xs text-muted">{c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
            <Section title="MCP tool calls">
              <ol className="list-decimal space-y-1 pl-5 font-mono text-xs">
                {r.toolCalls.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ol>
            </Section>
          </div>
        </div>
      )}
    </>
  );
}
