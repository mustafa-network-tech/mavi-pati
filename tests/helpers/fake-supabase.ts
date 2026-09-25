// A tiny in-memory stand-in for the supabase-js query builder, enough to exercise the
// MK Pati AI orchestration. Filters are applied; every query is logged for assertions.
type Row = Record<string, unknown>;
type Filter = [string, string, unknown];
export type LoggedQuery = { table: string; op: "select" | "insert"; filters: Filter[]; columns: string };

const compare = (value: unknown, operand: unknown) => String(value ?? "").localeCompare(String(operand));
const likeToRegExp = (pattern: string) =>
  new RegExp(`^${pattern.replace(/\\([\\%_])/g, "$1").split("%").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i");

function matches(row: Row, [kind, column, operand]: Filter) {
  const value = row[column];
  switch (kind) {
    case "eq":
      return value === operand;
    case "neq":
      return value !== operand;
    case "in":
      return (operand as unknown[]).includes(value);
    case "is":
      return value === operand;
    case "ilike":
      return typeof value === "string" && likeToRegExp(String(operand)).test(value);
    case "gte":
      return value != null && compare(value, operand) >= 0;
    case "gt":
      return value != null && compare(value, operand) > 0;
    case "lte":
      return value != null && compare(value, operand) <= 0;
    case "lt":
      return value != null && compare(value, operand) < 0;
    default:
      return true;
  }
}

class Query implements PromiseLike<{ data: unknown; error: null; count: number | null }> {
  private filters: Filter[] = [];
  private op: "select" | "insert" = "select";
  private rows: Row[] = [];
  private columns = "*";
  private head = false;

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  select(columns = "*", options?: { head?: boolean }) {
    if (this.op === "select") this.columns = columns;
    this.head = !!options?.head;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  private filter(kind: string, column: string, operand: unknown) {
    this.filters.push([kind, column, operand]);
    return this;
  }
  eq(column: string, value: unknown) { return this.filter("eq", column, value); }
  neq(column: string, value: unknown) { return this.filter("neq", column, value); }
  in(column: string, value: unknown[]) { return this.filter("in", column, value); }
  is(column: string, value: unknown) { return this.filter("is", column, value); }
  ilike(column: string, value: string) { return this.filter("ilike", column, value); }
  gte(column: string, value: unknown) { return this.filter("gte", column, value); }
  gt(column: string, value: unknown) { return this.filter("gt", column, value); }
  lte(column: string, value: unknown) { return this.filter("lte", column, value); }
  lt(column: string, value: unknown) { return this.filter("lt", column, value); }
  order() { return this; }
  limit() { return this; }

  private execute() {
    this.db.log.push({ table: this.table, op: this.op, filters: this.filters, columns: this.columns });
    const table = (this.db.tables[this.table] ??= []);
    if (this.op === "insert") {
      const inserted = this.rows.map((row) => ({ id: `${this.table}-${table.length + 1}`, ...row }));
      table.push(...inserted);
      return inserted;
    }
    return table.filter((row) => this.filters.every((filter) => matches(row, filter)));
  }
  async maybeSingle() {
    return { data: this.execute()[0] ?? null, error: null };
  }
  async single() {
    return { data: this.execute()[0] ?? null, error: null };
  }
  then<Result1 = { data: unknown; error: null; count: number | null }, Result2 = never>(
    resolve?: ((value: { data: unknown; error: null; count: number | null }) => Result1 | PromiseLike<Result1>) | null,
    reject?: ((reason: unknown) => Result2 | PromiseLike<Result2>) | null,
  ) {
    return Promise.resolve()
      .then(() => {
        const rows = this.execute();
        return { data: this.head ? null : rows, error: null, count: rows.length };
      })
      .then(resolve, reject);
  }
}

export class FakeSupabase {
  log: LoggedQuery[] = [];
  rpcCalls: { name: string; args: Row }[] = [];
  constructor(
    public tables: Record<string, Row[]>,
    private readonly rpcHandler: (name: string, args: Row) => { data: unknown; error: { message: string; code?: string } | null } = () => ({
      data: 9,
      error: null,
    }),
  ) {}
  from(table: string) {
    return new Query(this, table);
  }
  async rpc(name: string, args: Row) {
    this.rpcCalls.push({ name, args });
    return this.rpcHandler(name, args);
  }
}
