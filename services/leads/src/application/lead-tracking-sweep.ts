import type { Clock } from "@platform/contracts";
import { MAX_BUSINESS_EVENT_AGE_MS } from "@platform/tracking";
import type { Logger } from "@platform/utils";
import type { Lead } from "../domain/lead";
import type { LeadRepository } from "../domain/lead-repository";
import { trackingSubjectOf } from "./lead-tracking";
import type { LeadTrackingPort } from "./ports";

/** A lead younger than this is still being emitted by the request that saved it. */
export const LEAD_TRACKING_MIN_AGE_MS = 2 * 60_000;
/**
 * A lead still pending after this long is marked `failed` and never sent: the ingest pipeline refuses a business
 * event older than its 7-day window (`MAX_BUSINESS_EVENT_AGE_MS`), so a later send could only be refused.
 */
export const LEAD_TRACKING_MAX_AGE_MS = MAX_BUSINESS_EVENT_AGE_MS;

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_TENANT_LIMIT = 50;
const DEFAULT_BUDGET_MS = 4 * 60_000;

export interface LeadTrackingSweepDeps {
  readonly leads: LeadRepository;
  readonly tracking: LeadTrackingPort;
  readonly clock: Clock;
  readonly logger?: Logger;
  /** Leads taken per tenant per pass (the rest is served by the next pass). */
  readonly batchSize?: number;
  /** Tenants looked at per pass. */
  readonly tenantLimit?: number;
  /** One pass stops starting new work after this long. */
  readonly budgetMs?: number;
}

export interface LeadTrackingSweepReport {
  /** Tenants that had something due. */
  readonly tenants: number;
  /** Leads looked at. */
  readonly scanned: number;
  /** Re-emitted and marked sent. */
  readonly sent: number;
  /** Older than the 7-day window: marked failed, not sent. */
  readonly expired: number;
  /** Could not be sent or marked this pass; still pending (counts only, no lead data). */
  readonly errored: number;
}

/**
 * Tracking P2-D9: the safety net behind `SubmitLead`'s own emission. A lead whose emission failed (outbox down, the
 * process died between the insert and the publish, the mark that follows a publish failed) stays `pending`; this pass
 * finds the ones older than two minutes and sends them again. The send is idempotent by construction (the event's id
 * derives from tenant + lead id and the outbox ignores a repeat), so a pass that runs twice at once, or a lead sent by
 * both the request and a pass, is still one event.
 *
 * Short transactions: every repository call is its own transaction and the send (a database append in its own
 * transaction, outside this class) happens between them, so no transaction is ever held open across it.
 */
export class SweepPendingLeadTracking {
  private readonly deps: LeadTrackingSweepDeps;

  constructor(deps: LeadTrackingSweepDeps) {
    this.deps = deps;
  }

  async run(): Promise<LeadTrackingSweepReport> {
    const { leads, tracking, clock } = this.deps;
    const batchSize = this.deps.batchSize ?? DEFAULT_BATCH_SIZE;
    const budgetMs = this.deps.budgetMs ?? DEFAULT_BUDGET_MS;
    const startedAt = clock.now().getTime();
    const dueBefore = new Date(startedAt - LEAD_TRACKING_MIN_AGE_MS);

    const tenants = await leads.listTenantsWithPendingTracking(
      dueBefore,
      this.deps.tenantLimit ?? DEFAULT_TENANT_LIMIT,
    );
    let scanned = 0;
    let sent = 0;
    let expired = 0;
    let errored = 0;

    for (const tenantId of tenants) {
      if (clock.now().getTime() - startedAt > budgetMs) break;
      let due: readonly Lead[];
      try {
        due = await leads.listPendingTracking(tenantId, {
          createdBefore: dueBefore,
          limit: batchSize,
        });
      } catch (error) {
        errored += 1;
        this.deps.logger?.error("lead tracking sweep: a tenant's pending leads could not be read", {
          error: error instanceof Error ? error.name : "unknown",
        });
        continue;
      }
      for (const lead of due) {
        scanned += 1;
        const at = clock.now();
        try {
          if (at.getTime() - lead.props.createdAt.getTime() > LEAD_TRACKING_MAX_AGE_MS) {
            if (await leads.markTracking(tenantId, lead.props.id, "failed", at)) expired += 1;
            continue;
          }
          await tracking.emit(trackingSubjectOf(tenantId, lead));
          // false = another sweeper (or the request itself) settled it first: still one event, nothing to count
          if (await leads.markTracking(tenantId, lead.props.id, "sent", clock.now())) sent += 1;
        } catch (error) {
          errored += 1;
          this.deps.logger?.warn("lead tracking sweep: a lead stays pending for the next pass", {
            error: error instanceof Error ? error.name : "unknown",
          });
        }
      }
    }
    return { tenants: tenants.length, scanned, sent, expired, errored };
  }
}
