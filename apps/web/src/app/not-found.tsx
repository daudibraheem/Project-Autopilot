import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/10 text-accent">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><circle cx="12" cy="12" r="8" /><path d="M9.5 9.5 14.5 14.5M14.5 9.5 9.5 14.5" strokeLinecap="round" /></svg>
      </div>
      <div>
        <h1 className="text-xl font-semibold">Off the board</h1>
        <p className="mt-1 text-sm text-muted">That page isn't in this sprint. Let's get you back.</p>
      </div>
      <Link href="/" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover">Back to Overview</Link>
    </div>
  );
}
