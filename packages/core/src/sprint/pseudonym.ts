/**
 * Pseudonymisation (AGENTS.md rule 9). People become stable pseudonyms ("Member A") at sync time.
 * Real names live only in PersonAlias and are resolved only by the UI layer.
 */
import { prisma } from "@autopilot/db";
import { nameTokens } from "../policy";
import type { PersonRef } from "./types";

export function pseudonymFor(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Member ${s}`;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class Pseudonymiser {
  private byExternal = new Map<string, { realName: string; pseudonym: string }>();
  private constructor(private provider: string) {}

  static async load(provider: string): Promise<Pseudonymiser> {
    const p = new Pseudonymiser(provider);
    const rows = await prisma.personAlias.findMany({ where: { provider }, orderBy: { createdAt: "asc" } });
    for (const r of rows) p.byExternal.set(r.externalId, { realName: r.realName, pseudonym: r.pseudonym });
    return p;
  }

  /** Stable pseudonym for a person (creates the alias row on first sight). */
  async refFor(person: PersonRef | null): Promise<string | null> {
    if (!person) return null;
    const hit = this.byExternal.get(person.externalId);
    if (hit) return hit.pseudonym;
    const count = await prisma.personAlias.count();
    let pseudonym = pseudonymFor(count);
    // never reuse a pseudonym across providers
    while (await prisma.personAlias.findUnique({ where: { pseudonym } })) pseudonym = pseudonymFor(count + Math.floor(Math.random() * 1000));
    await prisma.personAlias.create({ data: { provider: this.provider, externalId: person.externalId, realName: person.displayName, pseudonym } });
    this.byExternal.set(person.externalId, { realName: person.displayName, pseudonym });
    return pseudonym;
  }

  realNames(): string[] {
    return [...this.byExternal.values()].map((v) => v.realName);
  }

  /** Replace every known real name (full name, then each part ≥ 3 letters) with its pseudonym. */
  scrub(text: string): string {
    if (!text) return text;
    let out = text;
    const pairs: { token: string; pseudonym: string }[] = [];
    for (const v of this.byExternal.values()) for (const t of nameTokens([v.realName])) pairs.push({ token: t, pseudonym: v.pseudonym });
    pairs.sort((a, b) => b.token.length - a.token.length);
    for (const { token, pseudonym } of pairs) {
      out = out.replace(new RegExp(`(^|[^\\p{L}@])@?${esc(token)}(?=$|[^\\p{L}])`, "giu"), (_m, pre) => `${pre}${pseudonym}`);
    }
    return out;
  }
}

/** All real names on record (for the real-name guard). */
export async function allRealNames(): Promise<string[]> {
  return (await prisma.personAlias.findMany({ select: { realName: true } })).map((r) => r.realName);
}

/** pseudonym → real name, for the UI layer only. */
export async function aliasMapForUi(): Promise<Record<string, string>> {
  const rows = await prisma.personAlias.findMany({ select: { pseudonym: true, realName: true } });
  return Object.fromEntries(rows.map((r) => [r.pseudonym, r.realName]));
}
