import { type AgentMode, jobMode, MODE_HINT } from "@/lib/modes";
import { cx } from "./ui";

/** The three agent-journey modes, with one highlighted. */
export function ModesBar({ active }: { active: AgentMode }) {
  const modes: AgentMode[] = ["Assistant", "Coworker", "Ambient"];
  return (
    <div className="mb-6 grid gap-2 sm:grid-cols-3">
      {modes.map((m) => (
        <div key={m} className={cx("rounded-lg border px-3 py-2", m === active ? "border-accent bg-accent/10" : "border-line bg-surface")}>
          <p className={cx("text-sm font-medium", m === active && "text-accent")}>{m}</p>
          <p className="text-xs text-muted">{MODE_HINT[m]}</p>
        </div>
      ))}
    </div>
  );
}

/** A small badge for the mode that started a job (Coworker vs Ambient). */
export function ModeBadge({ source }: { source: string }) {
  const mode = jobMode(source);
  return (
    <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted" title={`${mode}: ${MODE_HINT[mode]} (source: ${source})`}>
      {mode}
    </span>
  );
}
