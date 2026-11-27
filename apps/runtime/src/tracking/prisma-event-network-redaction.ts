/**
 * Postgres adapter for the 90-day IP / user-agent redaction of tracking event records (Tracking P1-D10).
 *
 * `tracking_event_records` and `tracking_event_revisions` are append-only by design; this job is the one
 * deliberate exception, and a narrow one: it removes the IP address and user agent (see `retention.ts` for
 * exactly which keys) from records older than the retention, stamps `network_redacted_at` on each so it is never
 * visited again, and touches nothing else. Every write names the tenant and runs in that tenant's scope.
 *
 * Which tenants have work is found with a cross-tenant read of the record table, which carries no row-level
 * security today; the read only returns tenant ids.
 */

import { runInTenantTransaction, type Database, type Prisma } from "@platform/db";
import {
  redactDestinationEntries,
  redactEnvelopeNetwork,
  type EventNetworkRedactionPort,
} from "@platform/tracking";

/** Tenants looked at per scan; the rest are served by the next pass. */
const TENANT_SCAN_LIMIT = 200;
/** One batch is one transaction of up to `limit` row updates; give it room beyond Prisma's 5 s default. */
const BATCH_TIMEOUT_MS = 60_000;

const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export class PrismaEventNetworkRedaction implements EventNetworkRedactionPort {
  constructor(private readonly db: Database) {}

  async tenantsWithUnredactedEvents(cutoff: Date): Promise<readonly string[]> {
    const rows = await this.db.$queryRaw<{ tenant_id: string }[]>`
      SELECT DISTINCT tenant_id
      FROM "tracking"."tracking_event_records"
      WHERE network_redacted_at IS NULL AND captured_at < ${cutoff.toISOString()}::timestamp
      ORDER BY tenant_id
      LIMIT ${TENANT_SCAN_LIMIT}`;
    return rows.map((row) => row.tenant_id);
  }

  redactBatch(tenantId: string, cutoff: Date, limit: number, at: Date): Promise<number> {
    return runInTenantTransaction(
      this.db,
      tenantId,
      async (tx) => {
        const records = await tx.trackingEventRecord.findMany({
          where: { tenantId, networkRedactedAt: null, capturedAt: { lt: cutoff } },
          orderBy: { capturedAt: "asc" },
          take: limit,
          select: { id: true, eventId: true, envelope: true, destinationHistory: true },
        });
        if (records.length === 0) return 0;

        for (const record of records) {
          const envelope = redactEnvelopeNetwork(record.envelope);
          const destinationHistory = redactDestinationEntries(record.destinationHistory);
          await tx.trackingEventRecord.updateMany({
            where: { tenantId, id: record.id, networkRedactedAt: null },
            data: {
              ...(envelope === record.envelope ? {} : { envelope: asJson(envelope) }),
              ...(destinationHistory === record.destinationHistory
                ? {}
                : { destinationHistory: asJson(destinationHistory) }),
              networkRedactedAt: at,
            },
          });
        }

        // The revisions carry the final per-destination entries, with the same rendered payloads.
        const revisions = await tx.trackingEventRevision.findMany({
          where: { tenantId, eventId: { in: records.map((record) => record.eventId) } },
          select: { id: true, destinations: true },
        });
        for (const revision of revisions) {
          const destinations = redactDestinationEntries(revision.destinations);
          if (destinations === revision.destinations) continue;
          await tx.trackingEventRevision.updateMany({
            where: { tenantId, id: revision.id },
            data: { destinations: asJson(destinations) },
          });
        }
        return records.length;
      },
      { timeoutMs: BATCH_TIMEOUT_MS },
    );
  }
}
