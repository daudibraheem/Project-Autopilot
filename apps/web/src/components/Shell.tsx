"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import type { SystemInfo } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";
import { cx } from "./ui";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/jobs", label: "Jobs" },
  { href: "/approvals", label: "Approvals" },
  { href: "/trust", label: "Trust ledger" },
  { href: "/lessons", label: "Lessons" },
  { href: "/audit", label: "Audit log" },
  { href: "/ml", label: "ML classifier" },
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
  const next: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
  const label: Record<Theme, string> = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" };
  return (
    <button
      type="button"
      onClick={() => {
        const t = next[theme];
        setTheme(t);
        try {
          localStorage.setItem("theme", t);
        } catch {}
        applyTheme(t);
      }}
      className="rounded-lg px-2.5 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-fg"
      aria-label={`${label[theme]}. Switch to ${next[theme]}.`}
    >
      {label[theme]}
    </button>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { data: sys } = usePoll<SystemInfo>("/api/system", 4000);
  return (
    <div className="min-h-screen lg:flex">
      <aside className="border-b border-line bg-surface lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-5 py-4 lg:block">
          <Link href="/" className="block">
            <span className="text-[15px] font-semibold tracking-tight">Project Autopilot</span>
            <span className="mt-0.5 block text-xs text-muted">Keeps one project healthy</span>
          </Link>
          <div className="lg:hidden">
            <ThemeToggle />
          </div>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:px-3">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex items-center justify-between whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors",
                  active ? "bg-surface-2 font-medium text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                {n.label}
                {n.href === "/approvals" && sys && sys.pendingApprovals > 0 && (
                  <span className="ml-2 rounded-full bg-warn-bg px-1.5 text-xs font-semibold text-warn">{sys.pendingApprovals}</span>
                )}
              </Link>
            );
          })}
        </nav>
        {sys && (
          <div className="hidden space-y-1.5 border-t border-line px-5 py-4 text-xs text-muted lg:absolute lg:bottom-0 lg:block lg:w-60">
            <div>
              Provider <span className="font-mono text-fg">{sys.provider}</span>
            </div>
            <div>
              Worker <span className="font-mono text-fg">{sys.workerModel}</span>
            </div>
            <div>
              Verifier <span className="font-mono text-fg">{sys.verifierModel}</span>
            </div>
            <div>
              Sandbox <span className={cx("font-mono", sys.sandbox.unsafe ? "text-bad" : "text-fg")}>{sys.sandbox.mode}</span>
            </div>
            <div className="pt-2">
              <ThemeToggle />
            </div>
          </div>
        )}
      </aside>
      <div className="min-w-0 flex-1">
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
    </div>
  );
}
