import type { Clock } from "@platform/contracts";
import type { Database } from "@platform/db";
import {
  PrismaLeadRepository,
  SweepPendingLeadTracking,
  type LeadTrackingPort,
  type LeadTrackingSweepReport,
} from "@platform/leads";
import type { Logger } from "@platform/utils";

export interface LeadTrackingSweepDeps {
  readonly prisma: Database;
  /** The same adapter the request path uses (`apps/runtime`): envelope + outbox, idempotent per lead. */
  readonly tracking: LeadTrackingPort;
  readonly clock: Clock;
  readonly logger?: Logger;
}

/**
 * Tracking P2-D9: one pass of the lead tracking sweeper over the Prisma lead repository — re-sends `pending` leads
 * older than two minutes, marks the ones older than seven days `failed`. The worker (`apps/runtime`) owns the
 * schedule and the single-flight lock; this is the work. It lives here, next to the wiring that builds the request
 * path's `SubmitLead`, because the worker depends on `@platform/admin` and not on the leads service directly.
 */
export function createLeadTrackingSweep(
  deps: LeadTrackingSweepDeps,
): () => Promise<LeadTrackingSweepReport> {
  const sweeper = new SweepPendingLeadTracking({
    leads: new PrismaLeadRepository({ prisma: deps.prisma }),
    tracking: deps.tracking,
    clock: deps.clock,
    ...(deps.logger === undefined ? {} : { logger: deps.logger }),
  });
  return () => sweeper.run();
}
