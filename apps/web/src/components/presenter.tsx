"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { post } from "@/lib/usePoll";
import { toast } from "./kit";
import { cx } from "./ui";

const STEPS = [
  { title: "Team health at a glance", href: "/", anchor: "overview", caption: "The whole team's health on one screen: standup, stuck work, forecast and code." },
  { title: "Run the morning routine", href: "/", anchor: "run-routine", caption: "One click runs the full scrum — check, draft, verify, gate — then it waits for you." },
  { title: "The sprint board", href: "/sprint", anchor: "board", caption: "Humans and AI agents on one board. Stuck work is flagged with a plain-words reason." },
  { title: "The standup brief", href: "/standup", anchor: "brief", caption: "Every sentence ends in a source. The model worded the facts; it never chose a number." },
  { title: "Approvals", href: "/approvals", anchor: "approvals", caption: "Checks passed. You approve the brief and nudges — nudges are copied, never auto-sent." },
  { title: "Scope change", href: "/sprint", anchor: "forecast", caption: "Add a mid-sprint item and watch the forecast drop live." },
  { title: "Your AI teammates", href: "/agents", anchor: "agents", caption: "Agents earn trust as work is approved — and nudges always need a human." },
];

function clearSpotlight() {
  for (const el of document.querySelectorAll(".spotlight")) el.classList.remove("spotlight");
}

function PresenterBarInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [on, setOn] = useState(false);
  const [idx, setIdx] = useState(0);
  const [resetting, setResetting] = useState(false);

  // Enable via ?presenter=1 (persisted) so it survives navigation; exit clears it.
  useEffect(() => {
    let enabled = params.get("presenter") === "1";
    try {
      if (enabled) localStorage.setItem("presenter", "1");
      else enabled = localStorage.getItem("presenter") === "1";
    } catch {}
    setOn(enabled);
  }, [params]);

  const step = STEPS[idx]!;

  // Navigate to the step's page if needed.
  useEffect(() => {
    if (on && pathname !== step.href) router.push(step.href);
  }, [on, pathname, step.href, router]);

  // Spotlight the step's anchor once we're on the right page.
  useEffect(() => {
    if (!on || pathname !== step.href) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => {
      clearSpotlight();
      const el = document.querySelector(`[data-presenter="${step.anchor}"]`);
      if (el) {
        el.classList.add("spotlight");
        el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      }
    }, 380);
    return () => {
      clearTimeout(t);
      clearSpotlight();
    };
  }, [on, pathname, step.href, step.anchor]);

  const reset = useCallback(async () => {
    setResetting(true);
    try {
      await post("/api/demo/reset");
      toast("Demo reset to the starting state", "ok");
      router.push("/");
      router.refresh();
      setIdx(0);
    } catch (e) {
      toast((e as Error).message, "info");
    } finally {
      setResetting(false);
    }
  }, [router]);

  // Keyboard shortcuts: → / ← steps, R reset.
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") setIdx((i) => Math.min(STEPS.length - 1, i + 1));
      else if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      else if (e.key === "r" || e.key === "R") reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on, reset]);

  // Toggle the presenter body class (hides debug detail unless hovered).
  useEffect(() => {
    document.documentElement.classList.toggle("presenter", on);
    return () => document.documentElement.classList.remove("presenter");
  }, [on]);

  if (!on) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/95 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] backdrop-blur">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3">
        <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">Step {idx + 1} of {STEPS.length}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{step.title}</div>
          <div className="truncate text-xs text-muted">{step.caption}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40" aria-label="Previous step">← Back</button>
          <button type="button" onClick={() => setIdx((i) => Math.min(STEPS.length - 1, i + 1))} disabled={idx === STEPS.length - 1} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-40" aria-label="Next step">Next →</button>
          <button type="button" onClick={reset} disabled={resetting} className="ml-1 rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-fg" title="Reset demo (R)">{resetting ? "Resetting…" : "Reset demo"}</button>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.removeItem("presenter");
              } catch {}
              setOn(false);
              clearSpotlight();
            }}
            className="rounded-lg px-2 py-1.5 text-sm text-muted hover:text-fg"
            aria-label="Exit presenter mode"
          >
            Exit
          </button>
        </div>
      </div>
      <div className="mx-auto mt-2 flex max-w-4xl gap-1">
        {STEPS.map((s, i) => (
          <button key={s.anchor} type="button" onClick={() => setIdx(i)} className={cx("h-1 flex-1 rounded-full transition-colors", i <= idx ? "bg-accent" : "bg-surface-2")} aria-label={`Go to step ${i + 1}`} />
        ))}
      </div>
    </div>
  );
}

export function PresenterBar() {
  return (
    <Suspense fallback={null}>
      <PresenterBarInner />
    </Suspense>
  );
}
