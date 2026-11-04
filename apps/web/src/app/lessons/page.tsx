"use client";
import Link from "next/link";
import { cx, Empty, ErrorNote, Loading, Mono, PageHeader } from "@/components/ui";
import { usePoll } from "@/lib/usePoll";

interface Lesson {
  id: string;
  jobId: string | null;
  jobType: string;
  goalId: string;
  result: string;
  confidence: number;
  evidence: string;
  lesson: string;
  nextTime: string;
  createdAt: string;
}

export default function LessonsPage() {
  const { data, error } = usePoll<Lesson[]>("/api/lessons", 5000);
  return (
    <>
      <PageHeader
        title="Lessons"
        subtitle={
          <>
            Written after every job (to the database and <Mono>memory/lessons.md</Mono>), deduplicated, and loaded into the next job of the same type.
          </>
        }
      />
      <ErrorNote error={error} />
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <Empty>No lessons yet. They appear after the first job finishes.</Empty>
      ) : (
        <div className="space-y-4">
          {data.map((l) => (
            <article key={l.id} className="rounded-xl border border-line bg-surface p-5">
              <h2 className="font-mono text-sm">
                # {l.createdAt.slice(0, 10)} · {l.jobType} · {l.goalId}
              </h2>
              <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[100px_1fr]">
                <dt className="text-muted">result</dt>
                <dd>
                  <span className={cx("font-medium", l.result === "pass" ? "text-ok" : "text-bad")}>{l.result}</span>
                  <span className="ml-3 text-muted">confidence {Math.round(l.confidence * 100)}%</span>
                </dd>
                <dt className="text-muted">evidence</dt>
                <dd className="text-muted">{l.evidence}</dd>
                <dt className="text-muted">lesson</dt>
                <dd className="font-medium">{l.lesson}</dd>
                <dt className="text-muted">next time</dt>
                <dd>{l.nextTime}</dd>
              </dl>
              {l.jobId && (
                <Link href={`/jobs/${l.jobId}`} className="mt-3 inline-block font-mono text-xs text-accent hover:underline">
                  from {l.jobId}
                </Link>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
