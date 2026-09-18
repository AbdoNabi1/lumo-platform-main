import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { JourneyStore } from "../ports/journey-store";
import type { SessionHistoryStore } from "../ports/session-history-store";
import type { SessionStore } from "../ports/session-store";
import type { SessionTimelineEntry } from "../ports/session-timeline";

export interface GetJourneyTimelineInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly visitorId: string;
}

export interface GetJourneyTimelineOutput {
  readonly entries: readonly SessionTimelineEntry[];
}

export interface GetJourneyTimelineDeps {
  readonly sessions: SessionStore;
  readonly history: SessionHistoryStore;
  readonly journey: JourneyStore;
}

/**
 * The Session Stitching Engine's own history view — every session lifecycle event
 * (started/activity/closed) across every session belonging to this visitor, interleaved
 * chronologically with every journey transition (organic or explicit) that names them. Mirrors
 * `GetIdentityTimeline`'s "one API, several views" shape: the brief's "Historical Sessions" and
 * "Transition History" read models are pure filters over this one `entries` list by `kind`, not
 * separate use cases — the same reasoning `GetCustomerProfile`'s single merged read already
 * establishes for its own four named views (Completeness/Freshness/Source Attribution/Confidence).
 * Distinct from the future cross-domain Customer Timeline (Phase 6.8); see `session-timeline.ts`.
 */
export class GetJourneyTimeline implements UseCase<
  GetJourneyTimelineInput,
  GetJourneyTimelineOutput,
  DomainError
> {
  private readonly deps: GetJourneyTimelineDeps;

  constructor(deps: GetJourneyTimelineDeps) {
    this.deps = deps;
  }

  async execute(
    input: GetJourneyTimelineInput,
  ): Promise<Result<GetJourneyTimelineOutput, DomainError>> {
    const [sessions, transitions] = await Promise.all([
      this.deps.sessions.listForVisitor(input.visitorId, input.tenantId),
      this.deps.journey.listForVisitor(input.visitorId, input.tenantId),
    ]);

    const sessionEntries: SessionTimelineEntry[] = [];
    for (const session of sessions) {
      const snapshots = [
        ...(await this.deps.history.listFor(session.sessionId, input.tenantId)),
      ].sort((a, b) => a.version - b.version);
      snapshots.forEach((snapshot, index) => {
        sessionEntries.push({
          kind:
            snapshot.status === "closed"
              ? "session_closed"
              : index === 0
                ? "session_started"
                : "session_activity",
          occurredAt: snapshot.capturedAt,
          sessionId: snapshot.sessionId,
          closeReason: snapshot.status === "closed" ? snapshot.closeReason : undefined,
        });
      });
    }

    const transitionEntries: SessionTimelineEntry[] = transitions.map((transition) => ({
      kind: "transition",
      occurredAt: transition.occurredAt,
      transitionId: transition.id,
      transitionKind: transition.kind,
      fromSessionId: transition.fromSessionId,
      toSessionId: transition.toSessionId,
      reason: transition.reason,
      actor: transition.actor,
    }));

    const entries = [...sessionEntries, ...transitionEntries].sort((a, b) =>
      a.occurredAt.localeCompare(b.occurredAt),
    );

    return ok({ entries });
  }
}
