"use client";
import { useState } from "react";
import { post } from "@/lib/usePoll";
import { toast } from "./kit";
import { Button, cx } from "./ui";

// Mirrors MORNING_ROUTINE_STAGES on the server (plain presentational copy).
const STAGES = [
  { key: "check_goals", label: "Check goals", caption: "Running the standing team-health checks — all plain code." },
  { key: "find_stuck", label: "Find stuck work", caption: "Scanning the board for no activity, reviews waiting, or work blocked by a failing build." },
  { key: "draft_brief", label: "Draft brief", caption: "An AI worker words the facts into a standup brief. It only writes; every number comes from code." },
  { key: "verifier_check", label: "Verifier check", caption: "A different AI checks every claim against the data — no blame, no invented blockers." },
  { key: "safety_gate", label: "Safety gate", caption: "Plain code re-checks sources, counts, people-safety and the verifier verdict." },
  { key: "waiting", label: "Waiting for you", caption: "Nothing is sent. The brief and nudges wait for your approval." },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RoutineResult {
  nudgeCount: number;
  stuckCount: number;
  forecastPct: number | null;
  error?: string;
}

export function MorningRoutine({ onDone }: { onDone?: () => void }) {
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState(-1);
  const [done, setDone] = useState(-1);
  const [ran, setRan] = useState(false);

  async function run() {
    setRunning(true);
    setActive(-1);
    setDone(-1);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const delay = reduce ? 0 : 1100;
    const pending = post<RoutineResult>("/api/morning-routine").catch((e) => ({ error: (e as Error).message }) as RoutineResult);
    for (let i = 0; i < STAGES.length; i++) {
      setActive(i);
      await sleep(delay);
      setDone(i);
    }
    const r = await pending;
    setActive(-1);
    setRunning(false);
    setRan(true);
    if ("error" in r && r.error) toast(r.error, "info");
    else {
      toast(`Brief and ${r.nudgeCount} nudge${r.nudgeCount === 1 ? "" : "s"} ready for your approval`, "ok");
      onDone?.();
    }
  }

  const caption = active >= 0 ? STAGES[active]!.caption : ran ? "Done — your brief and nudges are in Approvals." : "One click runs the whole morning scrum: check, draft, verify, gate — then it waits for you.";

  return (
    <div data-presenter="run-routine">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Run morning routine</h2>
          <p className="mt-0.5 text-xs text-muted">The full scrum flow, start to finish.</p>
        </div>
        <Button variant="primary" busy={running} onClick={run} disabled={running}>
          {running ? "Running…" : ran ? "Run again" : "Run morning routine"}
        </Button>
      </div>

      <ol className="mt-5 flex items-center gap-1 overflow-x-auto pb-1">
        {STAGES.map((s, i) => {
          const state = i <= done ? "done" : i === active ? "active" : "idle";
          return (
            <li key={s.key} className="flex min-w-0 flex-1 items-center gap-1">
              <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
                <span
                  className={cx(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-semibold transition-all duration-300",
                    state === "done" && "border-ok bg-ok-bg text-ok",
                    state === "active" && "animate-pulse border-accent bg-accent text-accent-fg",
                    state === "idle" && "border-line bg-surface text-muted",
                  )}
                >
                  {state === "done" ? "✓" : i + 1}
                </span>
                <span className={cx("text-[11px] leading-tight", state === "idle" ? "text-muted" : "font-medium text-fg")}>{s.label}</span>
              </div>
              {i < STAGES.length - 1 && <span className={cx("h-0.5 w-6 shrink-0 rounded-full transition-colors duration-300", i < done ? "bg-ok" : "bg-line")} />}
            </li>
          );
        })}
      </ol>

      <p className="mt-3 min-h-[2.5rem] rounded-lg bg-surface-2 px-3.5 py-2.5 text-xs text-muted transition-opacity">{caption}</p>
    </div>
  );
}
