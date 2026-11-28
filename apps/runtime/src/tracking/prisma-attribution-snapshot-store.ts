/**
 * Postgres adapter for the attribution snapshot of an order (Tracking P2-D8): `tracking.attribution_snapshots`.
 *
 * The table is RLS-forced. Every statement runs in ONE short tenant-scoped transaction (`app.tenant_id` set first by
 * `runReadScoped` / `runInTenantTransaction`) and names the tenant in its `where` as well, so the application filter
 * and the policy agree.
 *
 * - `putIfAbsent` is `createMany … skipDuplicates` (`ON CONFLICT DO NOTHING` on the `(tenant, kind, ref)` key): the
 *   FIRST write wins, a replay or a race is `exists` and changes nothing — never a unique-violation error.
 * - Retention (P2-D8): the only cross-tenant statement is the scan for tenants with work, a read behind the explicit
 *   `app.retention_scan` switch (the same policy the profile table has). Everything else runs in the row's tenant.
 */

import { runInTenantTransaction, runReadScoped, type Database, type Prisma } from "@platform/db";
import {
  isClickIdName,
  type AttributionSnapshotStore,
  type AttributionSnapshotWrite,
  type AttributionSubjectKind,
  type BusinessAttributionSnapshot,
  type SnapshotClickId,
} from "@platform/tracking";

/** Tenants looked at per scan; the rest are served by the next pass. */
const TENANT_SCAN_LIMIT = 200;
/** One batch is one transaction of up to `limit` rows; give it room beyond Prisma's 5 s default. */
const BATCH_TIMEOUT_MS = 60_000;

const COOKIE_KEYS = ["fbp", "fbc", "ttp", "scid", "ga"] as const;
const UTM_KEYS = ["source", "medium", "campaign", "content", "term"] as const;

interface SnapshotRow {
  readonly visitorId: string | null;
  readonly sessionId: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly pageUrl: string | null;
  readonly referrer: string | null;
  readonly cookies: unknown;
  readonly clickIds: unknown;
  readonly utm: unknown;
}

const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

function stringMap<K extends string>(
  value: unknown,
  keys: readonly K[],
): Partial<Record<K, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const entry = (value as Record<string, unknown>)[key];
    if (typeof entry === "string" && entry !== "") out[key] = entry;
  }
  return out;
}

function clickIdsOf(value: unknown): readonly SnapshotClickId[] {
  if (!Array.isArray(value)) return [];
  const out: SnapshotClickId[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { name, value: clickValue, capturedAt } = entry as Record<string, unknown>;
    if (
      typeof name === "string" &&
      isClickIdName(name) &&
      typeof clickValue === "string" &&
      typeof capturedAt === "string"
    ) {
      out.push({ name, value: clickValue, capturedAt });
    }
  }
  return out;
}

/** Row → the plain read-model snapshot. Tolerant: a hand-edited JSON column yields fewer fields, never a throw. */
function toSnapshot(row: SnapshotRow): BusinessAttributionSnapshot {
  const cookies = stringMap(row.cookies, COOKIE_KEYS);
  const utm = stringMap(row.utm, UTM_KEYS);
  const clickIds = clickIdsOf(row.clickIds);
  return {
    ...(row.visitorId === null ? {} : { visitorId: row.visitorId }),
    ...(row.sessionId === null ? {} : { sessionId: row.sessionId }),
    ...(row.ip === null ? {} : { ip: row.ip }),
    ...(row.userAgent === null ? {} : { userAgent: row.userAgent }),
    ...(row.pageUrl === null ? {} : { pageUrl: row.pageUrl }),
    ...(row.referrer === null ? {} : { referrer: row.referrer }),
    ...(Object.keys(cookies).length === 0 ? {} : { cookies }),
    ...(clickIds.length === 0 ? {} : { clickIds }),
    ...(Object.keys(utm).length === 0 ? {} : { utm }),
  };
}

export class PrismaAttributionSnapshotStore implements AttributionSnapshotStore {
  constructor(private readonly db: Database) {}

  putIfAbsent(write: AttributionSnapshotWrite): Promise<"created" | "exists"> {
    const { tenantId, snapshot } = write;
    return runInTenantTransaction(this.db, tenantId, async (tx) => {
      const inserted = await tx.trackingAttributionSnapshot.createMany({
        data: [
          {
            tenantId,
            subjectKind: write.subjectKind,
            subjectRef: write.subjectRef,
            visitorId: snapshot.visitorId ?? null,
            sessionId: snapshot.sessionId ?? null,
            ip: snapshot.ip ?? null,
            userAgent: snapshot.userAgent ?? null,
            pageUrl: snapshot.pageUrl ?? null,
            referrer: snapshot.referrer ?? null,
            cookies: asJson(snapshot.cookies ?? {}),
            clickIds: asJson(snapshot.clickIds ?? []),
            utm: asJson(snapshot.utm ?? {}),
            capturedAt: new Date(write.capturedAt),
          },
        ],
        skipDuplicates: true,
      });
      return inserted.count === 0 ? "exists" : "created";
    });
  }

  find(
    tenantId: string,
    subjectKind: AttributionSubjectKind,
    subjectRef: string,
  ): Promise<BusinessAttributionSnapshot | null> {
    return runReadScoped(this.db, tenantId, async (tx) => {
      const row = await tx.trackingAttributionSnapshot.findFirst({
        where: { tenantId, subjectKind, subjectRef },
      });
      return row === null ? null : toSnapshot(row);
    });
  }

  deleteSubjects(
    tenantId: string,
    subjectKind: AttributionSubjectKind,
    subjectRefs: readonly string[],
  ): Promise<number> {
    if (subjectRefs.length === 0) return Promise.resolve(0);
    return runInTenantTransaction(this.db, tenantId, async (tx) => {
      const result = await tx.trackingAttributionSnapshot.deleteMany({
        where: { tenantId, subjectKind, subjectRef: { in: [...subjectRefs] } },
      });
      return result.count;
    });
  }

  /** Cross-tenant, read-only, behind the explicit `app.retention_scan` switch (see the migration). */
  async tenantsWithSnapshotWork(
    networkCutoff: Date,
    deleteCutoff: Date,
  ): Promise<readonly string[]> {
    const rows = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.retention_scan', 'on', true)`;
      return tx.$queryRaw<{ tenant_id: string }[]>`
        SELECT DISTINCT tenant_id
        FROM "tracking"."attribution_snapshots"
        WHERE (network_redacted_at IS NULL AND captured_at < ${networkCutoff.toISOString()}::timestamp)
           OR captured_at < ${deleteCutoff.toISOString()}::timestamp
        ORDER BY tenant_id
        LIMIT ${TENANT_SCAN_LIMIT}`;
    });
    return rows.map((row) => row.tenant_id);
  }

  redactNetworkBatch(tenantId: string, cutoff: Date, limit: number, at: Date): Promise<number> {
    return runInTenantTransaction(
      this.db,
      tenantId,
      async (tx) => {
        const due = await tx.trackingAttributionSnapshot.findMany({
          where: { tenantId, networkRedactedAt: null, capturedAt: { lt: cutoff } },
          orderBy: { capturedAt: "asc" },
          take: limit,
          select: { subjectKind: true, subjectRef: true },
        });
        if (due.length === 0) return 0;
        const updated = await tx.trackingAttributionSnapshot.updateMany({
          where: {
            tenantId,
            networkRedactedAt: null,
            OR: due.map((row) => ({ subjectKind: row.subjectKind, subjectRef: row.subjectRef })),
          },
          data: { ip: null, userAgent: null, networkRedactedAt: at },
        });
        return updated.count;
      },
      { timeoutMs: BATCH_TIMEOUT_MS },
    );
  }

  deleteExpiredBatch(tenantId: string, cutoff: Date, limit: number): Promise<number> {
    return runInTenantTransaction(
      this.db,
      tenantId,
      async (tx) => {
        const due = await tx.trackingAttributionSnapshot.findMany({
          where: { tenantId, capturedAt: { lt: cutoff } },
          orderBy: { capturedAt: "asc" },
          take: limit,
          select: { subjectKind: true, subjectRef: true },
        });
        if (due.length === 0) return 0;
        const removed = await tx.trackingAttributionSnapshot.deleteMany({
          where: {
            tenantId,
            capturedAt: { lt: cutoff },
            OR: due.map((row) => ({ subjectKind: row.subjectKind, subjectRef: row.subjectRef })),
          },
        });
        return removed.count;
      },
      { timeoutMs: BATCH_TIMEOUT_MS },
    );
  }
}
