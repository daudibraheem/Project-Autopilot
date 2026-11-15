import type { People } from "./types";

/** UI layer only: replace pseudonyms ("Member A") with real display names at render time. */
export function restoreNames(text: string, people: People | undefined): string {
  if (!people || !text) return text;
  return text.replace(/\bMember [A-Z]{1,2}\b/g, (p) => people[p] ?? p);
}

export function personName(ref: string | null | undefined, people: People | undefined): string {
  if (!ref) return "Unassigned";
  return people?.[ref] ?? ref;
}
