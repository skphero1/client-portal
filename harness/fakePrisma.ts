// In-memory stand-in for PrismaClient, used ONLY to run the real GraphQL
// resolvers/repo/DataLoaders without a Postgres server. It implements exactly
// the Prisma methods the app calls, against the real seed data, and counts
// calls so DataLoader batching (N+1) can be verified.
type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {
  tenant: [],
  user: [],
  tenantMembership: [],
  project: [],
  ticket: [],
  invoice: [],
};

export const callCounts: Record<string, number> = {};

function count(key: string): void {
  callCounts[key] = (callCounts[key] ?? 0) + 1;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function matchCondition(value: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
    const c = cond as Record<string, unknown>;
    if ('in' in c) return (c.in as unknown[]).some((v) => sameValue(value, v));
    if ('lt' in c) return compareValues(value, c.lt) < 0;
    if ('gt' in c) return compareValues(value, c.gt) > 0;
    if ('equals' in c) return sameValue(value, c.equals);
    return false;
  }
  return sameValue(value, cond);
}

function matchWhere(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'AND') {
      if (!(cond as Record<string, unknown>[]).every((w) => matchWhere(row, w))) return false;
    } else if (key === 'OR') {
      if (!(cond as Record<string, unknown>[]).some((w) => matchWhere(row, w))) return false;
    } else if (!matchCondition(row[key], cond)) {
      return false;
    }
  }
  return true;
}

function applyOrderBy(rows: Row[], orderBy: Record<string, string>[] | undefined): Row[] {
  if (!orderBy || orderBy.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const spec of orderBy) {
      const [field, dir] = Object.entries(spec)[0] as [string, string];
      const cmp = compareValues(a[field], b[field]);
      if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

function findUserById(id: string): Row | undefined {
  return tables.user.find((u) => u.id === id);
}

function withAuthor(ticket: Row): Row {
  const author = findUserById(ticket.createdById as string);
  return {
    ...clone(ticket),
    createdBy: author
      ? { id: author.id, name: author.name, email: author.email, role: author.role }
      : null,
  };
}

function makeModel(table: string) {
  return {
    findUnique: async (args: { where: Record<string, unknown>; include?: Record<string, unknown> }): Promise<Row | null> => {
      count(`${table}.findUnique`);
      const row = tables[table].find((r) => matchWhere(r, args.where));
      if (!row) return null;
      const out = clone(row);
      if (table === 'user' && args.include?.memberships) {
        const memberships = tables.tenantMembership
          .filter((m) => m.userId === row.id)
          .sort((a, b) => String(a.tenantId).localeCompare(String(b.tenantId)))
          .map((m) => ({
            ...clone(m),
            tenant: clone(tables.tenant.find((t) => t.id === m.tenantId)),
          }));
        (out as Row).memberships = memberships;
      }
      return out;
    },
    findFirst: async (args: { where?: Record<string, unknown> }): Promise<Row | null> => {
      count(`${table}.findFirst`);
      return clone(tables[table].find((r) => matchWhere(r, args.where)) ?? null);
    },
    findMany: async (args: {
      where?: Record<string, unknown>;
      orderBy?: Record<string, string>[];
      take?: number;
      include?: Record<string, unknown>;
    }): Promise<Row[]> => {
      count(`${table}.findMany`);
      let rows = tables[table].filter((r) => matchWhere(r, args.where));
      rows = applyOrderBy(rows, args.orderBy);
      if (typeof args.take === 'number') rows = rows.slice(0, args.take);
      if (table === 'ticket' && args.include?.createdBy) {
        return rows.map(withAuthor);
      }
      return rows.map((r) => clone(r));
    },
    createMany: async (args: { data: Row[] }): Promise<{ count: number }> => {
      count(`${table}.createMany`);
      for (const d of args.data) tables[table].push(clone(d));
      return { count: args.data.length };
    },
    create: async (args: { data: Row; include?: Record<string, unknown> }): Promise<Row> => {
      count(`${table}.create`);
      const now = new Date();
      const row: Row = {
        id: (args.data.id as string) ?? `tkt_fake_${tables[table].length + 1}`,
        ...clone(args.data),
        createdAt: now,
        updatedAt: now,
      };
      tables[table].push(row);
      if (table === 'ticket') return withAuthor(row);
      return clone(row);
    },
    update: async (args: { where: Record<string, unknown>; data: Row; include?: Record<string, unknown> }): Promise<Row> => {
      count(`${table}.update`);
      const row = tables[table].find((r) => matchWhere(r, args.where));
      if (!row) throw new Error('Record to update not found.');
      Object.assign(row, clone(args.data), { updatedAt: new Date() });
      if (table === 'ticket') return withAuthor(row);
      return clone(row);
    },
    deleteMany: async (): Promise<{ count: number }> => {
      count(`${table}.deleteMany`);
      const n = tables[table].length;
      tables[table].length = 0;
      return { count: n };
    },
  };
}

export const fakePrisma = {
  tenant: makeModel('tenant'),
  user: makeModel('user'),
  tenantMembership: makeModel('tenantMembership'),
  project: makeModel('project'),
  ticket: makeModel('ticket'),
  invoice: makeModel('invoice'),
  $transaction: async <T>(ops: Promise<T>[]): Promise<T[]> => Promise.all(ops),
  $disconnect: async (): Promise<void> => undefined,
};

export function tableCounts(): Record<string, number> {
  return Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
}
