export function newJobId(): string {
  const t = Date.now().toString(36).slice(-5);
  const r = Math.random().toString(36).slice(2, 5);
  return `j-${t}${r}`;
}
