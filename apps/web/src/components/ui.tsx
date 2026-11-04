"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "ghost";

export function Button({ variant = "secondary", className, busy, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  const styles: Record<Variant, string> = {
    primary: "bg-accent text-accent-fg hover:bg-accent-hover border border-transparent",
    secondary: "bg-surface text-fg border border-line hover:bg-surface-2",
    danger: "bg-surface text-bad border border-bad/40 hover:bg-bad-bg",
    ghost: "text-muted hover:text-fg hover:bg-surface-2 border border-transparent",
  };
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={cx(
        "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        styles[variant],
        className,
      )}
    >
      {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

const STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  green: { label: "Healthy", cls: "bg-ok-bg text-ok", dot: "bg-ok" },
  amber: { label: "At risk", cls: "bg-warn-bg text-warn", dot: "bg-warn" },
  red: { label: "Broken", cls: "bg-bad-bg text-bad", dot: "bg-bad" },
};

export function goalTone(status: string | undefined) {
  return STATUS[status ?? ""] ?? { label: "Not checked", cls: "bg-surface-2 text-muted", dot: "bg-muted" };
}

export function GoalStatus({ status, large }: { status?: string; large?: boolean }) {
  const s = goalTone(status);
  return (
    <span className={cx("inline-flex items-center gap-2 rounded-full font-medium", s.cls, large ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs")}>
      <span className={cx("h-2 w-2 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}

const JOB_STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "bg-surface-2 text-muted" },
  running: { label: "Worker running", cls: "bg-accent/10 text-accent" },
  verifying: { label: "Verifying", cls: "bg-accent/10 text-accent" },
  gating: { label: "Gate running", cls: "bg-accent/10 text-accent" },
  awaiting_approval: { label: "Awaiting approval", cls: "bg-warn-bg text-warn" },
  changes_requested: { label: "Changes requested", cls: "bg-warn-bg text-warn" },
  merged: { label: "Merged", cls: "bg-ok-bg text-ok" },
  approved: { label: "Approved · PR ready", cls: "bg-ok-bg text-ok" },
  rejected: { label: "Rejected", cls: "bg-bad-bg text-bad" },
  gate_failed: { label: "Gate failed", cls: "bg-bad-bg text-bad" },
  failed: { label: "Failed", cls: "bg-bad-bg text-bad" },
  budget_exceeded: { label: "Budget exceeded", cls: "bg-bad-bg text-bad" },
  killed: { label: "Stopped by kill switch", cls: "bg-bad-bg text-bad" },
};

export function JobStatus({ status }: { status: string }) {
  const s = JOB_STATUS[status] ?? { label: status, cls: "bg-surface-2 text-muted" };
  const live = ["running", "verifying", "gating", "queued"].includes(status);
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", s.cls)}>
      {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />}
      {s.label}
    </span>
  );
}

export function Section({ title, aside, children, className, id }: { title: string; aside?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx("rounded-xl border border-line bg-surface", className)}>
      <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside && <div className="text-xs text-muted">{aside}</div>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cx("font-mono text-[0.85em]", className)}>{children}</code>;
}

export function Check({ ok }: { ok: boolean }) {
  return (
    <span
      className={cx("inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold", ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad")}
      role="img"
      aria-label={ok ? "passed" : "failed"}
    >
      {ok ? "✓" : "✕"}
    </span>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="rounded-lg border border-bad/30 bg-bad-bg px-4 py-3 text-sm text-bad">{error}</p>;
}

export function Loading() {
  return <p className="text-sm text-muted">Loading…</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}
