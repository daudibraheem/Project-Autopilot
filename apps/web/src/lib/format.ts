export function usd(n: number | null | undefined, digits = 4): string {
  const v = n ?? 0;
  if (v === 0) return "$0";
  if (v < 0.0001) return "<$0.0001";
  return `$${v.toFixed(v >= 1 ? 2 : digits)}`;
}

export function timeAgo(d: string | Date | null | undefined): string {
  if (!d) return "never";
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function clock(d: string | Date): string {
  return new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function dateTime(d: string | Date): string {
  return new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function ms(n: number): string {
  if (!n) return "–";
  return n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`;
}

export function hours(h: number): string {
  if (h === 0) return "0 h";
  if (h < 0.1) return `${Math.max(1, Math.round(h * 60))} min`;
  return `${h.toFixed(1)} h`;
}

export const GOAL_SHORT: Record<string, string> = {
  "no-critical-vulns": "G1",
  "main-build-green": "G2",
  "setup-docs-work": "G3",
};
