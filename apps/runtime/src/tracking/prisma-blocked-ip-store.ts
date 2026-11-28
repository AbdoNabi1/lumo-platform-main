/**
 * Postgres adapter for the per-store IP block list (Tracking P1-D9): `tracking.blocked_ips`.
 *
 * The table is RLS-forced. Every statement runs in ONE short transaction that sets `app.tenant_id` first
 * (`runInTenantTransaction`) and names the tenant in its `where` as well, so the application filter and the policy
 * agree. `add` is idempotent on `(tenant_id, cidr)` — `createMany … skipDuplicates` turns a repeat (or a lost race
 * between two admins) into a no-op and the stored row is read back; `remove` of a missing row is a `false`, never
 * an error. Rows hold an address range, a note and the staff id that added it — nothing is logged here.
 */

import { runInTenantTransaction, type Database } from "@platform/db";
import type { BlockedIpEntry, BlockedIpStore } from "@platform/tracking";

/** A store holds at most 500 entries (the service enforces it); the read is bounded regardless. */
const LIST_LIMIT = 1000;

interface BlockedIpRow {
  readonly id: string;
  readonly tenantId: string;
  readonly cidr: string;
  readonly note: string | null;
  readonly createdAt: Date;
  readonly createdBy: string | null;
}

function toEntry(row: BlockedIpRow): BlockedIpEntry {
  return {
    id: row.id,
    tenantId: row.tenantId,
    cidr: row.cidr,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

export class PrismaBlockedIpStore implements BlockedIpStore {
  constructor(private readonly db: Database) {}

  list(tenantId: string): Promise<readonly BlockedIpEntry[]> {
    return runInTenantTransaction(this.db, tenantId, async (tx) => {
      const rows = await tx.trackingBlockedIp.findMany({
        where: { tenantId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: LIST_LIMIT,
      });
      return rows.map(toEntry);
    });
  }

  add(
    entry: BlockedIpEntry,
  ): Promise<{ readonly entry: BlockedIpEntry; readonly created: boolean }> {
    return runInTenantTransaction(this.db, entry.tenantId, async (tx) => {
      const inserted = await tx.trackingBlockedIp.createMany({
        data: [
          {
            id: entry.id,
            tenantId: entry.tenantId,
            cidr: entry.cidr,
            note: entry.note,
            createdAt: new Date(entry.createdAt),
            createdBy: entry.createdBy,
          },
        ],
        skipDuplicates: true,
      });
      const stored = await tx.trackingBlockedIp.findFirst({
        where: { tenantId: entry.tenantId, cidr: entry.cidr },
      });
      return {
        entry: stored === null ? entry : toEntry(stored),
        created: inserted.count > 0,
      };
    });
  }

  remove(tenantId: string, id: string): Promise<boolean> {
    return runInTenantTransaction(this.db, tenantId, async (tx) => {
      const removed = await tx.trackingBlockedIp.deleteMany({ where: { tenantId, id } });
      return removed.count > 0;
    });
  }

  count(tenantId: string): Promise<number> {
    return runInTenantTransaction(this.db, tenantId, (tx) =>
      tx.trackingBlockedIp.count({ where: { tenantId } }),
    );
  }
}
