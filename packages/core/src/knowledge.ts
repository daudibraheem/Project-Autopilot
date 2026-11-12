/**
 * Knowledge base (RAG): runbook passages indexed in Postgres with full-text search.
 * FTS is the default and works fully offline. pgvector embeddings are an optional extra,
 * only when a real provider key is set (see DECISIONS §B); FTS remains the fallback.
 * The worker reaches this through the search_knowledge tool and must cite the source path.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@autopilot/db";

export interface KnowledgePassage {
  path: string;
  title: string;
  lineStart: number;
  lineEnd: number;
  content: string;
}

export interface KnowledgeHit {
  path: string;
  title: string;
  lineStart: number;
  lineEnd: number;
  snippet: string;
  rank: number;
}

/** A citation like docs/runbooks/dependency-upgrades.md:1-10. */
export function citation(h: Pick<KnowledgeHit, "path" | "lineStart" | "lineEnd">): string {
  return `${h.path}:${h.lineStart}-${h.lineEnd}`;
}

/** Split a markdown doc into passages, one per `##` section (the intro before the first is its own passage). */
export function splitIntoPassages(docPath: string, text: string): KnowledgePassage[] {
  const lines = text.split("\n");
  const docTitle = lines.find((l) => l.startsWith("# "))?.slice(2).trim() ?? docPath;
  const passages: KnowledgePassage[] = [];
  let start = 0;
  let heading = docTitle;
  const flush = (end: number) => {
    const body = lines.slice(start, end).join("\n").trim();
    if (body) passages.push({ path: docPath, title: heading, lineStart: start + 1, lineEnd: end, content: body });
  };
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!)) {
      if (i > start) flush(i);
      start = i;
      heading = `${docTitle} — ${lines[i]!.replace(/^##\s+/, "").trim()}`;
    }
  }
  flush(lines.length);
  return passages;
}

/** (Re)index docs/runbooks/*.md from the target repo into Postgres FTS. Returns the passage count. */
export async function indexKnowledgeFromRepo(repoPath: string): Promise<number> {
  const dir = path.join(repoPath, "docs", "runbooks");
  if (!existsSync(dir)) return 0;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  await prisma.knowledgeDoc.deleteMany({});
  let n = 0;
  for (const f of files) {
    const rel = path.posix.join("docs/runbooks", f);
    const text = readFileSync(path.join(dir, f), "utf8");
    for (const p of splitIntoPassages(rel, text)) {
      await prisma.knowledgeDoc.create({ data: { path: p.path, title: p.title, lineStart: p.lineStart, lineEnd: p.lineEnd, content: p.content } });
      n++;
    }
  }
  // tsv is an Unsupported("tsvector") column; populate it with raw SQL.
  await prisma.$executeRawUnsafe(`UPDATE "KnowledgeDoc" SET tsv = to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,'')) WHERE tsv IS NULL`);
  return n;
}

/** Query words → an OR tsquery ("a | b | c"), so any matching term returns a passage; ranking prefers more matches. */
export function toOrTsQuery(query: string): string {
  return [...new Set(query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].join(" | ");
}

/** Full-text search over indexed runbook passages. Returns passages with source path + line range. */
export async function searchKnowledge(query: string, limit = 3): Promise<KnowledgeHit[]> {
  const terms = toOrTsQuery(query);
  if (!terms) return [];
  try {
    const rows = await prisma.$queryRaw<{ path: string; title: string; lineStart: number; lineEnd: number; snippet: string; rank: number }[]>`
      SELECT path, title, "lineStart", "lineEnd",
             ts_headline('english', content, to_tsquery('english', ${terms}), 'MaxFragments=1, MaxWords=40, MinWords=12, ShortWord=2') AS snippet,
             ts_rank(tsv, to_tsquery('english', ${terms})) AS rank
      FROM "KnowledgeDoc"
      WHERE tsv @@ to_tsquery('english', ${terms})
      ORDER BY rank DESC
      LIMIT ${limit}`;
    return rows.map((r) => ({ ...r, rank: Number(r.rank) }));
  } catch {
    // No DB / no FTS available (e.g. unit tests): degrade gracefully.
    return [];
  }
}

/** Does a runbook path exist in the index? Used by the gate to confirm the worker's citations. */
export async function knowledgePathsExist(paths: string[]): Promise<Record<string, boolean>> {
  if (paths.length === 0) return {};
  const rows = await prisma.knowledgeDoc.findMany({ where: { path: { in: paths } }, select: { path: true } });
  const have = new Set(rows.map((r) => r.path));
  return Object.fromEntries(paths.map((p) => [p, have.has(p)]));
}

/** Extract docs/runbooks/* citations mentioned in free text (with or without a line range). */
export function knowledgeCitationsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\b(docs\/runbooks\/[\w./-]+\.md)(?::\d+-\d+)?/g)].map((m) => m[1]!))];
}
