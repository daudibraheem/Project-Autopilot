"use client";
/** Shared design-system primitives for the polished Scrum UI. */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cx } from "./ui";

// ---------------- Card ----------------
export function Card({ children, className, interactive, id }: { children: ReactNode; className?: string; interactive?: boolean; id?: string }) {
  return <div id={id} className={cx("rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)]", interactive && "transition-shadow hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)]", className)}>{children}</div>;
}

// ---------------- Status pill ----------------
const TONES: Record<string, string> = {
  green: "bg-ok-bg text-ok",
  amber: "bg-warn-bg text-warn",
  red: "bg-bad-bg text-bad",
  accent: "bg-accent/10 text-accent",
  agent: "bg-[color-mix(in_oklab,var(--accent),#a855f7_55%)]/15 text-[color-mix(in_oklab,var(--accent),#a855f7_55%)]",
  neutral: "bg-surface-2 text-muted",
};

export function StatusPill({ tone = "neutral", children, dot }: { tone?: keyof typeof TONES; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", TONES[tone])}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

// ---------------- Badge: Human / AI agent ----------------
export function Badge({ kind }: { kind: "human" | "agent" }) {
  return kind === "agent" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--accent),#a855f7_55%)]/15 px-2 py-0.5 text-[11px] font-medium text-[color-mix(in_oklab,var(--accent),#a855f7_55%)]" title="Worked by an Autopilot agent">
      <span aria-hidden>✦</span> AI agent
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted" title="Worked by a person">
      Human
    </span>
  );
}

// ---------------- Avatar (initials) ----------------
const AVATAR_COLORS = ["#2b50cf", "#1d7f47", "#9a5a00", "#7c3aed", "#0891b2", "#be123c"];
export function Avatar({ name, size = 24 }: { name: string | null | undefined; size?: number }) {
  const label = (name ?? "—").trim();
  const initials = label === "—" ? "–" : label.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  let h = 0;
  for (const c of label) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const bg = AVATAR_COLORS[h % AVATAR_COLORS.length];
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: bg, fontSize: size * 0.4 }} title={label} aria-hidden>
      {initials}
    </span>
  );
}

// ---------------- Tabs ----------------
export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: ReactNode }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="inline-flex gap-1 rounded-lg border border-line bg-surface-2 p-1" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          onClick={() => onChange(t.id)}
          className={cx("rounded-md px-3 py-1 text-xs font-medium transition-colors", t.id === active ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------------- Skeleton ----------------
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-surface-2", className)} aria-hidden />;
}

// ---------------- Empty state ----------------
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// ---------------- Animated number ----------------
export function AnimatedNumber({ value, suffix = "", duration = 650 }: { value: number; suffix?: string; duration?: number }) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = prev.current;
    prev.current = value;
    if (reduce || from === value) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      setDisplay(Math.round(from + (value - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return (
    <span className="tabular-nums">
      {display}
      {suffix}
    </span>
  );
}

// ---------------- Stat tile ----------------
export function Stat({ label, value, suffix, hint, animate }: { label: string; value: number | string; suffix?: string; hint?: ReactNode; animate?: boolean }) {
  return (
    <div>
      <div className="text-2xl font-semibold tracking-tight">{typeof value === "number" && animate ? <AnimatedNumber value={value} suffix={suffix} /> : <>{value}{suffix}</>}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

// ---------------- Drawer (right slide-over) ----------------
export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/30 animate-[fade_150ms_ease-out]" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l border-line bg-surface p-5 shadow-xl animate-[slidein_200ms_ease-out]">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------- Toast ----------------
export interface ToastMsg {
  id: number;
  msg: string;
  tone: "ok" | "info";
}
let toastListeners: ((t: ToastMsg) => void)[] = [];
export function toast(msg: string, tone: "ok" | "info" = "info") {
  const t: ToastMsg = { id: Date.now() + Math.random(), msg, tone };
  for (const l of toastListeners) l(t);
}
export function Toaster() {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  useEffect(() => {
    const l = (t: ToastMsg) => {
      setToasts((ts) => [...ts, t]);
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== t.id)), 4200);
    };
    toastListeners.push(l);
    return () => {
      toastListeners = toastListeners.filter((x) => x !== l);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cx("pointer-events-auto flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm shadow-lg animate-[slidein_200ms_ease-out]", t.tone === "ok" ? "border-ok/30 bg-ok-bg text-ok" : "border-line bg-surface text-fg")}
        >
          {t.tone === "ok" && <span aria-hidden>✓</span>}
          {t.msg}
        </div>
      ))}
    </div>
  );
}
