/**
 * Tiny in-memory stand-in for the Prisma client, enough for the Scrum Mode code paths
 * (sync, facts, stuck detection, trust, audit). Supports equality, in/notIn, lt/lte/gt/gte, not, contains.
 */
type Row = Record<string, unknown>;

function matchValue(v: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date) && !Array.isArray(cond)) {
    const c = cond as Record<string, unknown>;
    const cmp = (x: unknown) => (x instanceof Date ? x.getTime() : (x as number));
    if ("in" in c && !(c.in as unknown[]).includes(v)) return false;
    if ("notIn" in c && (c.notIn as unknown[]).includes(v)) return false;
    if ("lt" in c && !(cmp(v) < cmp(c.lt))) return false;
    if ("lte" in c && !(cmp(v) <= cmp(c.lte))) return false;
    if ("gt" in c && !(cmp(v) > cmp(c.gt))) return false;
    if ("gte" in c && !(cmp(v) >= cmp(c.gte))) return false;
    if ("not" in c && v === c.not) return false;
    if ("contains" in c && !String(v).includes(String(c.contains))) return false;
    if ("equals" in c && v !== c.equals) return false;
    return true;
  }
  if (v instanceof Date && cond instanceof Date) return v.getTime() === cond.getTime();
  return v === cond;
}

const matches = (row: Row, where: Row = {}) => Object.entries(where).every(([k, cond]) => matchValue(row[k], cond));

function sortRows(rows: Row[], orderBy?: Row | Row[]) {
  const orders = orderBy ? (Array.isArray(orderBy) ? orderBy : [orderBy]) : [];
  return [...rows].sort((a, b) => {
    for (const o of orders) {
      const [k, dir] = Object.entries(o)[0]!;
      const av = a[k] instanceof Date ? (a[k] as Date).getTime() : (a[k] as number | string);
      const bv = b[k] instanceof Date ? (b[k] as Date).getTime() : (b[k] as number | string);
      if (av === bv) continue;
      const r = av! < bv! ? -1 : 1;
      return dir === "desc" ? -r : r;
    }
    return 0;
  });
}

let seq = 0;

function table(idKey = "id") {
  const rows: Row[] = [];
  const withDefaults = (data: Row) => ({ [idKey]: data[idKey] ?? `mem${++seq}`, createdAt: new Date(), ...data });
  return {
    rows,
    async findMany(a: { where?: Row; orderBy?: Row | Row[]; take?: number } = {}) {
      const r = sortRows(rows.filter((x) => matches(x, a.where)), a.orderBy);
      return a.take ? r.slice(0, a.take) : r;
    },
    async findFirst(a: { where?: Row; orderBy?: Row | Row[] } = {}) {
      return sortRows(rows.filter((x) => matches(x, a.where)), a.orderBy)[0] ?? null;
    },
    async findUnique(a: { where: Row }) {
      return rows.find((x) => matches(x, a.where)) ?? null;
    },
    async findUniqueOrThrow(a: { where: Row }) {
      const r = rows.find((x) => matches(x, a.where));
      if (!r) throw new Error("not found");
      return r;
    },
    async count(a: { where?: Row } = {}) {
      return rows.filter((x) => matches(x, a.where)).length;
    },
    async create(a: { data: Row }) {
      const r = withDefaults(a.data);
      rows.push(r);
      return r;
    },
    async createMany(a: { data: Row[] }) {
      for (const d of a.data) rows.push(withDefaults(d));
      return { count: a.data.length };
    },
    async upsert(a: { where: Row; create: Row; update: Row }) {
      const r = rows.find((x) => matches(x, a.where));
      if (r) return Object.assign(r, a.update);
      const n = withDefaults(a.create);
      rows.push(n);
      return n;
    },
    async update(a: { where: Row; data: Row }) {
      const r = rows.find((x) => matches(x, a.where));
      if (!r) throw new Error("not found");
      return Object.assign(r, a.data);
    },
    async updateMany(a: { where?: Row; data: Row }) {
      const hit = rows.filter((x) => matches(x, a.where));
      for (const r of hit) Object.assign(r, a.data);
      return { count: hit.length };
    },
    async deleteMany(a: { where?: Row } = {}) {
      const keep = rows.filter((x) => !matches(x, a.where));
      const n = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count: n };
    },
  };
}

export function memoryDb() {
  return {
    auditEvent: table(),
    setting: table("key"),
    sprint: table(),
    workItem: table(),
    workItemEvent: table(),
    personAlias: table(),
    standupBrief: table(),
    nudgeDraft: table(),
    goalCheck: table(),
    regressionCheck: table("goalId"),
    job: table(),
    trustRecord: table("jobType"),
    trustEvent: table(),
    lesson: table(),
  };
}

export type MemoryDb = ReturnType<typeof memoryDb>;
