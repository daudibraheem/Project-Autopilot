"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import type { SystemInfo } from "@/lib/types";
import { post, usePoll } from "@/lib/usePoll";
import { Toaster } from "./kit";
import { PresenterBar } from "./presenter";
import { cx } from "./ui";

/** Tiny inline icon set (no icon dependency; crisp in both themes). */
function Icon({ name }: { name: string }) {
  const p: Record<string, ReactNode> = {
    overview: <path d="M3 10.5 12 4l9 6.5M5 9.5V20h5v-6h4v6h5V9.5" />,
    board: <><rect x="3" y="4" width="4.5" height="16" rx="1" /><rect x="9.75" y="4" width="4.5" height="10" rx="1" /><rect x="16.5" y="4" width="4.5" height="13" rx="1" /></>,
    standup: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h8M8 17h5" /></>,
    inbox: <path d="M4 13h4l2 3h4l2-3h4M4 13 6 5h12l2 8v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />,
    agents: <><circle cx="12" cy="8" r="3.2" /><path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" /><path d="M12 2v1.6" /></>,
    ask: <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4V6a1 1 0 0 1 1-1z" />,
    audit: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    jobs: <><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M8 6V4h8v2" /></>,
    trust: <path d="M12 3l7 3v5c0 4.4-3 8.4-7 9.5C8 19.4 5 15.4 5 11V6z" />,
    lessons: <path d="M4 5h9a3 3 0 0 1 3 3v11a2.5 2.5 0 0 0-2.5-2.5H4zM20 5h-1a3 3 0 0 0-3 3v11" />,
    ml: <><circle cx="6" cy="7" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="12" cy="17" r="2" /><path d="M7.5 8.5 11 15m6-6.5L13 15" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      {p[name] ?? <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}

const PRIMARY = [
  { href: "/", label: "Overview", icon: "overview" },
  { href: "/sprint", label: "Sprint", icon: "board" },
  { href: "/standup", label: "Standup", icon: "standup" },
  { href: "/approvals", label: "Approvals", icon: "inbox" },
  { href: "/agents", label: "Agents", icon: "agents" },
  { href: "/ask", label: "Ask", icon: "ask" },
  { href: "/audit", label: "Audit", icon: "audit" },
];
const SECONDARY = [
  { href: "/jobs", label: "Jobs", icon: "jobs" },
  { href: "/trust", label: "Trust ledger", icon: "trust" },
  { href: "/lessons", label: "Lessons", icon: "lessons" },
  { href: "/ml", label: "ML classifier", icon: "ml" },
];

type Theme = "light" | "dark" | "system";
function applyTheme(t: Theme) {
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}
function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    let saved: Theme = "system";
    try {
      saved = (localStorage.getItem("theme") as Theme) || "system";
    } catch {}
    setTheme(saved);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      let cur: Theme = "system";
      try {
        cur = (localStorage.getItem("theme") as Theme) || "system";
      } catch {}
      if (cur === "system") applyTheme("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const icon: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" };
  const nextT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
  return (
    <button
      type="button"
      onClick={() => {
        const t = nextT[theme];
        setTheme(t);
        try {
          localStorage.setItem("theme", t);
        } catch {}
        applyTheme(t);
      }}
      className="rounded-lg border border-line px-2.5 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-fg"
      aria-label={`Theme: ${theme}. Switch to ${nextT[theme]}.`}
      title={`Theme: ${theme}`}
    >
      <span aria-hidden>{icon[theme]}</span>
    </button>
  );
}

function dateRange(start?: string, end?: string): string {
  if (!start || !end) return "";
  const f = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${f(start)} – ${f(end)}`;
}

function NavLink({ href, label, icon, active, badge }: { href: string; label: string; icon: string; active: boolean; badge?: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors", active ? "bg-accent/10 font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-fg")}
    >
      <Icon name={icon} />
      <span className="flex-1 whitespace-nowrap">{label}</span>
      {badge ? <span className="rounded-full bg-warn-bg px-1.5 text-xs font-semibold text-warn">{badge}</span> : null}
    </Link>
  );
}

const TITLES: Record<string, string> = {
  "/": "Overview",
  "/sprint": "Sprint board",
  "/standup": "Standup",
  "/approvals": "Approvals",
  "/agents": "Agents",
  "/ask": "Ask Autopilot",
  "/audit": "Audit log",
  "/jobs": "Jobs",
  "/trust": "Trust ledger",
  "/lessons": "Lessons",
  "/ml": "ML classifier",
};

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { data: sys } = usePoll<SystemInfo>("/api/system", 4000);
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  useEffect(() => {
    const key = Object.keys(TITLES).find((h) => (h === "/" ? path === "/" : path.startsWith(h)));
    document.title = `${key ? TITLES[key] : "Not found"} · Autopilot`;
  }, [path]);
  return (
    <div className="min-h-screen lg:flex">
      <aside className="border-b border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r">
        <Link href="/" className="flex items-center gap-2.5 px-5 py-4">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-fg">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /></svg>
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold leading-tight tracking-tight">Autopilot</span>
            <span className="block text-xs text-muted">Scrum control room</span>
          </span>
        </Link>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-y-auto">
          {PRIMARY.map((n) => (
            <NavLink key={n.href} {...n} active={isActive(n.href)} badge={n.href === "/approvals" ? sys?.pendingApprovals : undefined} />
          ))}
          <div className="my-2 hidden border-t border-line lg:block" />
          {SECONDARY.map((n) => (
            <NavLink key={n.href} {...n} active={isActive(n.href)} />
          ))}
        </nav>
        {sys && (
          <div data-debug className="hidden space-y-1.5 border-t border-line px-5 py-4 text-xs text-muted lg:block">
            <div>Provider <span className="font-mono text-fg">{sys.provider}</span></div>
            <div>Worker <span className="font-mono text-fg">{sys.workerModel}</span></div>
            <div>Sandbox <span className={cx("font-mono", sys.sandbox.unsafe ? "text-bad" : "text-fg")}>{sys.sandbox.mode}</span></div>
          </div>
        )}
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface/90 px-5 py-3 backdrop-blur sm:px-8">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{sys?.sprint?.name ?? "Project Autopilot"}</div>
            <div className="text-xs text-muted">{sys?.sprint ? dateRange(sys.sprint.start, sys.sprint.end) : "No active sprint"}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11px] text-muted sm:inline-flex" title="The same engine runs three ways">
              Assistant · Coworker · Ambient
            </span>
            <button
              type="button"
              onClick={() => post("/api/killswitch", { on: !sys?.killSwitch }).catch(() => {})}
              className={cx("rounded-lg border px-2.5 py-1.5 text-xs font-medium", sys?.killSwitch ? "border-bad/40 bg-bad-bg text-bad" : "border-line text-muted hover:bg-surface-2 hover:text-fg")}
              title="Kill switch: stop all new jobs"
            >
              {sys?.killSwitch ? "Kill switch: ON" : "Kill switch"}
            </button>
            <ThemeToggle />
          </div>
        </header>

        {sys?.killSwitch && (
          <div role="status" className="border-b border-bad/30 bg-bad-bg px-6 py-2.5 text-sm font-medium text-bad">
            Kill switch is on. No new jobs will start, and running jobs stop after their current step.
          </div>
        )}
        {sys?.sandbox.unsafe && (
          <div role="alert" className="border-b border-warn/30 bg-warn-bg px-6 py-2.5 text-sm text-warn">
            <strong>Unsafe: no container.</strong> Sandbox commands run directly on this machine ({sys.sandbox.reason}).
          </div>
        )}
        {sys?.routeError && <div className="border-b border-bad/30 bg-bad-bg px-6 py-2.5 text-sm text-bad">{sys.routeError}</div>}
        <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:py-10">{children}</main>
      </div>
      <Toaster />
      <PresenterBar />
    </div>
  );
}
