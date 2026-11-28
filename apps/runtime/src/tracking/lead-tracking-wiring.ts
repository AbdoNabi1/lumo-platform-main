/**
 * Production wiring of the lead tracking emitter (Tracking P2-D9): the adapter the request path emits through
 * (`apps/admin` `SubmitLead`) and the pass the worker's sweeper runs. Both are built over the SAME adapter, the SAME
 * outbox publisher and the SAME store-url resolver (one 5-minute cache per process), and both exist only while
 * `TRACKING_INGEST_ENABLED` is on: with ingest off nothing consumes `tracking.event.captured.v1`, so publishing would
 * only fill the outbox, and a deployment without the tracking tables never reads them.
 */

import { createLeadTrackingSweep, type LeadTrackingPort } from "@platform/admin";
import { PrismaOutboxEventPublisher } from "@platform/db";

import type { RuntimeCore } from "../composition";
import type { LeadTrackingSweepCounts } from "../lead-tracking-sweep-runtime";
import { OutboxLeadTrackingEmitter } from "./lead-tracking-emitter";
import { PrismaStoreUrlResolver } from "./prisma-store-url-resolver";

const emitters = new WeakMap<RuntimeCore, LeadTrackingPort>();

/** The leads service's tracking port over the Postgres outbox, or `null` while tracking ingest is off. */
export function buildLeadTrackingEmitter(core: RuntimeCore): LeadTrackingPort | null {
  if (!core.config.TRACKING_INGEST_ENABLED) return null;
  const existing = emitters.get(core);
  if (existing !== undefined) return existing;
  const emitter = new OutboxLeadTrackingEmitter({
    storeUrls: new PrismaStoreUrlResolver({
      db: core.prisma,
      platformTenantId: core.platformTenantId,
      ...(core.config.STOREFRONT_PUBLIC_URL === undefined
        ? {}
        : { fallbackUrl: core.config.STOREFRONT_PUBLIC_URL }),
      clock: core.clock,
    }),
    // P2-D6: one execution path through ingest. The outbox is the transport under both EVENT_TRANSPORT values.
    publisher: new PrismaOutboxEventPublisher(core.prisma, () => core.clock.now()),
    serializer: core.serializer,
    clock: core.clock,
  });
  emitters.set(core, emitter);
  return emitter;
}

/**
 * One pass of the lead tracking sweeper, or `null` while tracking ingest is off. The caller owns the schedule and the
 * single-flight lock (`startLeadTrackingSweep`); this is just the work.
 */
export function buildLeadTrackingSweep(
  core: RuntimeCore,
): (() => Promise<LeadTrackingSweepCounts>) | null {
  const tracking = buildLeadTrackingEmitter(core);
  if (tracking === null) return null;
  return createLeadTrackingSweep({
    prisma: core.prisma,
    tracking,
    clock: core.clock,
    logger: core.logger,
  });
}
