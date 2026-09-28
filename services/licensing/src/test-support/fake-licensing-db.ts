import type { TransactionClient } from "@platform/db";
import type { TransactionalUnitOfWork } from "@platform/repository";

/**
 * A database-free stand-in for the two Prisma delegates a coupon redemption touches
 * (`billingCoupon`, `invoice`), faithful to exactly the semantics the repositories rely on so the REAL
 * `PrismaCouponRepository`/`PrismaInvoiceRepository` and the REAL use cases run over it:
 *
 *  - `where` is matched on EVERY key the repository names, so a repository that forgot `tenantId`
 *    finds another tenant's row here (and a test goes red);
 *  - `updateMany` is a compare-and-swap: it updates only rows matching the whole `where` (including
 *    `version`) and reports how many it touched, which is what turns a lost race into `count: 0`;
 *  - rows are copied in and out, so two transactions never share an object the way the in-memory
 *    repositories' reference-sharing would let them;
 *  - a transaction's writes are undone if it throws, like a rolled-back Postgres transaction.
 *
 * `holdReads` deterministically forces N racers to all READ before any of them WRITES — the exact
 * interleaving that makes a read-check-write unsafe — and releases them together.
 * Test-only. It does NOT prove Postgres behaves this way; see the D-0xx trade-offs.
 */
type Row = Record<string, unknown>;
type Table = "billingCoupon" | "invoice";

interface UpdateArgs {
  readonly where: Row;
  readonly data: Row;
}

export class FakeLicensingDb {
  readonly tables: Record<Table, Map<string, Row>> = {
    billingCoupon: new Map(),
    invoice: new Map(),
  };
  private readonly holds = new Map<
    Table,
    { need: number; arrived: number; release: () => void; gate: Promise<void> }
  >();
  private clock = 0;

  /** The first `count` reads of `table` wait until all `count` have arrived. */
  holdReads(table: Table, count: number): void {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.holds.set(table, { need: count, arrived: 0, release, gate });
  }

  private async passHold(table: Table): Promise<void> {
    const hold = this.holds.get(table);
    if (hold === undefined) return;
    hold.arrived += 1;
    if (hold.arrived >= hold.need) {
      hold.release();
      this.holds.delete(table);
      return;
    }
    await hold.gate;
  }

  /** A transaction-scoped client whose writes register their own undo. */
  client(undo: Array<() => void>): TransactionClient {
    const delegate = (table: Table) => ({
      create: ({ data }: { data: Row }) => {
        const id = String(data["id"]);
        if (this.tables[table].has(id)) throw new Error(`Unique constraint failed on ${table}.id`);
        for (const existing of this.tables[table].values()) {
          if (
            table === "billingCoupon" &&
            existing["tenantId"] === data["tenantId"] &&
            existing["code"] === data["code"]
          ) {
            throw new Error("Unique constraint failed on billing_coupons (tenant_id, code)");
          }
        }
        this.clock += 1;
        this.tables[table].set(id, { ...structuredClone(data), createdAt: new Date(this.clock) });
        undo.push(() => this.tables[table].delete(id));
        return Promise.resolve(structuredClone(data));
      },
      findFirst: async ({ where }: { where: Row }) => {
        await this.passHold(table);
        for (const row of this.tables[table].values()) {
          if (matches(row, where)) return structuredClone(row);
        }
        return null;
      },
      findMany: ({ where, orderBy }: { where: Row; orderBy?: Row | readonly Row[] }) => {
        const found = [...this.tables[table].values()].filter((row) => matches(row, where));
        const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Row[];
        found.sort((a, b) => {
          for (const key of keys) {
            const [field, direction] = Object.entries(key)[0] as [string, "asc" | "desc"];
            const cmp = compare(a[field], b[field]);
            if (cmp !== 0) return direction === "desc" ? -cmp : cmp;
          }
          return 0;
        });
        return Promise.resolve(found.map((row) => structuredClone(row)));
      },
      updateMany: ({ where, data }: UpdateArgs) => {
        let count = 0;
        for (const [id, row] of this.tables[table]) {
          if (!matches(row, where)) continue;
          const before = structuredClone(row);
          const next: Row = { ...row };
          for (const [key, value] of Object.entries(data)) {
            if (isIncrement(value)) next[key] = Number(row[key]) + value.increment;
            else next[key] = structuredClone(value);
          }
          this.tables[table].set(id, next);
          undo.push(() => this.tables[table].set(id, before));
          count += 1;
        }
        return Promise.resolve({ count });
      },
    });
    return {
      billingCoupon: delegate("billingCoupon"),
      invoice: delegate("invoice"),
    } as unknown as TransactionClient;
  }
}

function isIncrement(value: unknown): value is { increment: number } {
  return typeof value === "object" && value !== null && "increment" in value;
}

function compare(a: unknown, b: unknown): number {
  const left = a instanceof Date ? a.getTime() : (a as number | string);
  const right = b instanceof Date ? b.getTime() : (b as number | string);
  return left < right ? -1 : left > right ? 1 : 0;
}

function matches(row: Row, where: Row): boolean {
  for (const [key, want] of Object.entries(where)) {
    const have = row[key];
    if (want instanceof Date || have instanceof Date) {
      if (new Date(have as string).getTime() !== new Date(want as string).getTime()) return false;
    } else if (typeof want === "object" && want !== null) {
      throw new Error(`FakeLicensingDb does not support a where operator on "${key}"`);
    } else if (have !== want) {
      return false;
    }
  }
  return true;
}

/** Runs the work against a fresh undo log and rolls it back if the work throws. */
export class FakeLicensingUnitOfWork implements TransactionalUnitOfWork<unknown> {
  private readonly db: FakeLicensingDb;

  constructor(db: FakeLicensingDb) {
    this.db = db;
  }

  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    const undo: Array<() => void> = [];
    try {
      return await work(this.db.client(undo));
    } catch (error) {
      for (const revert of undo.reverse()) revert();
      throw error;
    }
  }
}
