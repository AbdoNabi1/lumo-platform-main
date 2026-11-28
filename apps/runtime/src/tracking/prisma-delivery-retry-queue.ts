/**
 * Postgres adapter for the durable delivery-retry queue (Tracking P1-D2): `tracking.delivery_retries`.
 *
 * ## Supabase-pooler friendly
 *
 * Every statement is either a single autocommit query or one SHORT transaction. There is no `LISTEN`, no
 * session or advisory lock, no cursor and no long-held row lock: a claim is a lease written into the row
 * (`next_retry_at` pushed ahead) inside a transaction that ends before any vendor is called, so the
 * transaction pooler may hand every statement a different backend connection.
 *
 * ## Claiming
 *
 * ```sql
 * UPDATE … SET next_retry_at = <lease> WHERE id IN (
 *   SELECT id … WHERE tenant_id = $1 AND status = 'pending' AND next_retry_at <= $now
 *   ORDER BY next_retry_at LIMIT $n FOR UPDATE SKIP LOCKED
 * ) RETURNING …
 * ```
 *
 * `SKIP LOCKED` makes two sweepers that claim at the same instant take DISJOINT rows instead of waiting on
 * each other; the pushed `next_retry_at` keeps a row reserved after the transaction commits, so a sweeper
 * that is slow (or died) is only re-served once its lease runs out. Nothing here makes a sweeper wait.
 *
 * ## Tenancy
 *
 * The table is RLS-forced with a `tenant_isolation` policy and a read-only `due_scan_read` policy. The
 * cross-tenant part is the cheap read that finds which tenants have something due; every claim and every
 * write then runs in that tenant's own scope (`app.tenant_id` set for the transaction), so it keeps working
 * unchanged on the day the connection role stops bypassing RLS.
 *
 * Rows hold ids, counters, timestamps and a short sanitized error — no payload, no identity.
 */

import type { IdGenerator } from "@platform/contracts";
import { runInTenantTransaction, type Database } from "@platform/db";
import type {
  DeliveryRetryEntry,
  DeliveryRetryKey,
  DeliveryRetryQueuePort,
} from "@platform/tracking";

/** Tenants looked at per `claimDue` call; the rest are served by the next sweep. */
const TENANT_SCAN_LIMIT = 50;

interface ClaimedRow {
  readonly tenant_id: string;
  readonly event_id: string;
  readonly destination: string;
  readonly platform: string;
  readonly attempts: number;
  readonly event_timestamp: Date;
  readonly window_expires_at: Date;
  readonly next_retry_at: Date;
  readonly last_error: string | null;
}

/** Postgres `timestamp` columns are UTC wall-clock; an ISO string cast with `::timestamp` keeps it so. */
const iso = (date: Date): string => date.toISOString();

export class PrismaDeliveryRetryQueue implements DeliveryRetryQueuePort {
  constructor(
    private readonly db: Database,
    private readonly idGenerator: IdGenerator,
  ) {}

  async schedule(entry: DeliveryRetryEntry, at: Date): Promise<void> {
    await runInTenantTransaction(this.db, entry.tenantId, (tx) =>
      // ON CONFLICT DO NOTHING: parking the same delivery again (a redelivered ingest message) leaves
      // the existing schedule alone.
      tx.trackingDeliveryRetry.createMany({
        skipDuplicates: true,
        data: [
          {
            id: this.idGenerator.generate(),
            tenantId: entry.tenantId,
            eventId: entry.eventId,
            destination: entry.destination,
            platform: entry.platform,
            status: "pending",
            attempts: entry.attempts,
            eventTimestamp: entry.eventTimestamp,
            windowExpiresAt: entry.windowExpiresAt,
            nextRetryAt: entry.nextRetryAt,
            lastError: entry.lastError,
            createdAt: at,
            updatedAt: at,
          },
        ],
      }),
    );
  }

  async claimDue(input: {
    readonly limit: number;
    readonly now: Date;
    readonly leaseMs: number;
  }): Promise<readonly DeliveryRetryEntry[]> {
    const nowIso = iso(input.now);
    const leaseIso = iso(new Date(input.now.getTime() + input.leaseMs));

    // Cross-tenant, read-only, no locks: which tenants have something due, oldest first.
    const tenants = await this.db.$queryRaw<{ tenant_id: string }[]>`
      SELECT tenant_id
      FROM "tracking"."delivery_retries"
      WHERE status = 'pending' AND next_retry_at <= ${nowIso}::timestamp
      GROUP BY tenant_id
      ORDER BY MIN(next_retry_at) ASC
      LIMIT ${TENANT_SCAN_LIMIT}`;

    const claimed: DeliveryRetryEntry[] = [];
    for (const { tenant_id: tenantId } of tenants) {
      const remaining = input.limit - claimed.length;
      if (remaining <= 0) break;

      const rows = await runInTenantTransaction(
        this.db,
        tenantId,
        (tx) =>
          tx.$queryRaw<ClaimedRow[]>`
          UPDATE "tracking"."delivery_retries" AS r
          SET next_retry_at = ${leaseIso}::timestamp, updated_at = ${nowIso}::timestamp
          WHERE r.id IN (
            SELECT d.id
            FROM "tracking"."delivery_retries" AS d
            WHERE d.tenant_id = ${tenantId}
              AND d.status = 'pending'
              AND d.next_retry_at <= ${nowIso}::timestamp
            ORDER BY d.next_retry_at ASC
            LIMIT ${remaining}
            FOR UPDATE SKIP LOCKED
          )
          RETURNING r.tenant_id, r.event_id, r.destination, r.platform, r.attempts,
                    r.event_timestamp, r.window_expires_at, r.next_retry_at, r.last_error`,
      );
      for (const row of rows) {
        claimed.push({
          tenantId: row.tenant_id,
          eventId: row.event_id,
          destination: row.destination,
          platform: row.platform,
          attempts: row.attempts,
          eventTimestamp: row.event_timestamp,
          windowExpiresAt: row.window_expires_at,
          nextRetryAt: row.next_retry_at,
          lastError: row.last_error,
        });
      }
    }
    return claimed;
  }

  async markDelivered(key: DeliveryRetryKey, at: Date): Promise<void> {
    await runInTenantTransaction(this.db, key.tenantId, (tx) =>
      tx.trackingDeliveryRetry.updateMany({
        where: {
          tenantId: key.tenantId,
          eventId: key.eventId,
          destination: key.destination,
          status: "pending",
        },
        data: { status: "delivered", settledAt: at, updatedAt: at },
      }),
    );
  }

  async reschedule(
    key: DeliveryRetryKey,
    change: {
      readonly attempts: number;
      readonly nextRetryAt: Date;
      readonly lastError: string | null;
    },
    at: Date,
  ): Promise<void> {
    await runInTenantTransaction(this.db, key.tenantId, (tx) =>
      tx.trackingDeliveryRetry.updateMany({
        where: {
          tenantId: key.tenantId,
          eventId: key.eventId,
          destination: key.destination,
          status: "pending",
        },
        data: {
          attempts: change.attempts,
          nextRetryAt: change.nextRetryAt,
          lastError: change.lastError,
          updatedAt: at,
        },
      }),
    );
  }

  async markDeadLettered(key: DeliveryRetryKey, reason: string, at: Date): Promise<void> {
    await runInTenantTransaction(this.db, key.tenantId, (tx) =>
      tx.trackingDeliveryRetry.updateMany({
        where: {
          tenantId: key.tenantId,
          eventId: key.eventId,
          destination: key.destination,
          status: "pending",
        },
        data: { status: "dead_lettered", deadLetterReason: reason, settledAt: at, updatedAt: at },
      }),
    );
  }
}
