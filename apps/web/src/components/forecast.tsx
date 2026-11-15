"use client";
import type { Forecast } from "@/lib/types";
import { AnimatedNumber, Card, StatusPill } from "./kit";
import { cx } from "./ui";

function statusTone(p: number): "green" | "amber" | "red" {
  return p >= 0.7 ? "green" : p >= 0.4 ? "amber" : "red";
}
const TONE_STROKE: Record<string, string> = { green: "var(--green)", amber: "var(--amber)", red: "var(--red)" };

/** A 180° gauge of the probability, coloured by the S3 thresholds. */
export function Gauge({ probability }: { probability: number }) {
  const r = 72;
  const cx0 = 90;
  const cy0 = 88;
  const len = Math.PI * r;
  const tone = statusTone(probability);
  const path = `M ${cx0 - r} ${cy0} A ${r} ${r} 0 0 1 ${cx0 + r} ${cy0}`;
  return (
    <div className="relative mx-auto w-[180px]">
      <svg viewBox="0 0 180 104" width="180" height="104" role="img" aria-label={`${Math.round(probability * 100)} percent chance`}>
        <path d={path} fill="none" stroke="var(--surface-2)" strokeWidth="13" strokeLinecap="round" />
        <path d={path} fill="none" stroke={TONE_STROKE[tone]} strokeWidth="13" strokeLinecap="round" strokeDasharray={`${probability * len} ${len}`} style={{ transition: "stroke-dasharray 500ms ease-out" }} />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="text-3xl font-semibold tracking-tight" style={{ color: TONE_STROKE[tone] }}>
          <AnimatedNumber value={Math.round(probability * 100)} suffix="%" />
        </div>
      </div>
    </div>
  );
}

/** Burn-up: target line, actual-so-far, and the forecast p10–p90 band. */
export function Burnup({ f }: { f: Forecast }) {
  const w = 440;
  const h = 150;
  const padL = 28;
  const padB = 20;
  const maxDay = f.burnup.length - 1 || 1;
  const maxY = Math.max(f.totalPoints, ...f.burnup.map((b) => b.p90)) || 1;
  const x = (d: number) => padL + (d / maxDay) * (w - padL - 8);
  const y = (v: number) => h - padB - (v / maxY) * (h - padB - 10);
  const line = (sel: (b: Forecast["burnup"][number]) => number | null) =>
    f.burnup
      .filter((b) => sel(b) !== null)
      .map((b, i) => `${i === 0 ? "M" : "L"} ${x(b.day).toFixed(1)} ${y(sel(b) as number).toFixed(1)}`)
      .join(" ");
  const band = `${f.burnup.map((b) => `${x(b.day).toFixed(1)},${y(b.p90).toFixed(1)}`).join(" ")} ${[...f.burnup].reverse().map((b) => `${x(b.day).toFixed(1)},${y(b.p10).toFixed(1)}`).join(" ")}`;
  const todayDay = f.burnup.findLastIndex((b) => b.actual !== null);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label="Burn-up chart">
        <line x1={padL} y1={h - padB} x2={w - 8} y2={h - padB} stroke="var(--border)" />
        <line x1={padL} y1={10} x2={w - 8} y2={10} stroke="var(--border)" strokeDasharray="3 3" />
        <text x={w - 10} y={8} textAnchor="end" fontSize="9" fill="var(--muted)">target {f.totalPoints}</text>
        <polygon points={band} fill="var(--accent)" opacity="0.12" />
        <path d={line((b) => b.p50)} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.8" />
        <path d={line((b) => b.actual)} fill="none" stroke="var(--green)" strokeWidth="2.4" />
        {todayDay >= 0 && <circle cx={x(todayDay)} cy={y(f.burnup[todayDay]!.actual as number)} r="3.5" fill="var(--green)" />}
      </svg>
      <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted">
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-ok" /> done so far</span>
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 border-t border-dashed border-accent" /> forecast (p50)</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 bg-accent/15" /> p10–p90 range</span>
      </div>
    </div>
  );
}

export function ForecastPanel({ forecast, compact }: { forecast: Forecast; compact?: boolean }) {
  const tone = statusTone(forecast.probability);
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Sprint forecast</h2>
        <StatusPill tone={tone} dot>
          {tone === "green" ? "On track" : tone === "amber" ? "At risk" : "Off track"}
        </StatusPill>
      </div>
      <p className="mt-1 text-xs text-muted">Chance of hitting the sprint goal</p>
      <Gauge probability={forecast.probability} />
      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
        <div><div className="font-semibold tabular-nums">{forecast.completedPoints}</div><div className="text-muted">done</div></div>
        <div><div className="font-semibold tabular-nums">{forecast.remainingPoints}</div><div className="text-muted">left</div></div>
        <div><div className="font-semibold tabular-nums">{forecast.daysRemaining}</div><div className="text-muted">days left</div></div>
      </div>
      {!compact && (
        <div className="mt-4">
          <Burnup f={forecast} />
        </div>
      )}
      <p className={cx("mt-3 text-xs text-muted", compact && "line-clamp-3")}>{forecast.why.replace(/\s*\[sprint\]\s*$/, "")}</p>
    </Card>
  );
}
