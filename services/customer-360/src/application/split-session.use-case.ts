import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import { closeSession, openSession } from "../domain/customer-session";
import { toSnapshot } from "../domain/session-snapshot";
import { SessionClosed } from "../events/session-closed.event";
import { SessionSplit } from "../events/session-split.event";
import { SessionStarted } from "../events/session-started.event";
import type { JourneyStore } from "../ports/journey-store";
import type { SessionHistoryStore } from "../ports/session-history-store";
import type { SessionStore } from "../ports/session-store";

export interface SplitSessionInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  /** The session incorrectly containing more than one visit/person (the textbook case: a shared
   * kiosk or family device recorded as one continuous session_id). */
  readonly sessionId: string;
  /** The id to open for activity from the split point forward — caller-supplied, never a reuse of
   * `sessionId`. */
  readonly newSessionId: string;
  readonly splitAt: string;
  readonly reason: string;
  readonly actor: string;
}

export interface SplitSessionOutput {
  readonly transitionId: string;
  readonly newSessionId: string;
}

export interface SplitSessionDeps {
  readonly sessions: SessionStore;
  readonly history: SessionHistoryStore;
  readonly journey: JourneyStore;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Explicit, provenance-carrying correction for a session that actually spans two distinct
 * visits/people — closes `sessionId` (`closeReason: "explicit_split"`, only if still open; a
 * previously-closed session is left as-is) and opens `newSessionId` for everything from `splitAt`
 * forward, linked by an `explicit_split` transition. The original session's own recorded history is
 * never rewritten — only closed — matching the append-only rule the whole engine follows. This is
 * the session-side counterpart to `SplitIdentity`, but because a session has no notion of an
 * individually-retractable edge, the correction is "truncate and continue" rather than "retract one
 * observation". Three facts, three events (`SessionClosed`, `SessionStarted`, `SessionSplit`) — the
 * same one-event-per-asserted-fact shape `ObserveIdentityLink` already uses when one call produces
 * several edges.
 */
export class SplitSession implements UseCase<SplitSessionInput, SplitSessionOutput, DomainError> {
  private readonly deps: SplitSessionDeps;

  constructor(deps: SplitSessionDeps) {
    this.deps = deps;
  }

  async execute(input: SplitSessionInput): Promise<Result<SplitSessionOutput, DomainError>> {
    if (input.reason.trim() === "" || input.actor.trim() === "") {
      return err(
        new ValidationError("Split requires a reason and an actor", [
          { field: "reason", message: "required" },
        ]),
      );
    }
    if (input.sessionId === input.newSessionId) {
      return err(
        new ValidationError("The split-off session must have a different id from the original", [
          { field: "newSessionId", message: "must differ from sessionId" },
        ]),
      );
    }

    const existing = await this.deps.sessions.getCurrent(input.sessionId, input.tenantId);
    if (existing === null) {
      return err(
        new ValidationError("Cannot split a session that was never observed", [
          { field: "sessionId", message: "no matching session found" },
        ]),
      );
    }

    return this.deps.unitOfWork.run<Result<SplitSessionOutput, DomainError>>(async (tx) => {
      if (existing.status === "open") {
        const closed = closeSession(existing, "explicit_split", input.splitAt);
        const occurredAt = this.deps.clock.now();
        await this.deps.history.append(
          toSnapshot(closed, "split", occurredAt.toISOString()),
          input.tenantId,
          new SessionClosed(
            {
              eventId: this.deps.idGenerator.generate(),
              aggregateId: UniqueEntityId.from(closed.sessionId),
              occurredAt,
            },
            {
              sessionId: closed.sessionId,
              closeReason: "explicit_split",
              pageCount: closed.pageCount,
            },
          ),
          tx,
        );
        await this.deps.sessions.saveCurrent(closed, input.tenantId, tx);
      }

      const newSession = openSession({
        sessionId: input.newSessionId,
        visitorId: existing.visitorId,
        deviceId: existing.deviceId,
        journeyId: existing.journeyId,
        source: existing.source,
        startedAt: input.splitAt,
      });
      const startOccurredAt = this.deps.clock.now();
      await this.deps.history.append(
        toSnapshot(newSession, "split", startOccurredAt.toISOString()),
        input.tenantId,
        new SessionStarted(
          {
            eventId: this.deps.idGenerator.generate(),
            aggregateId: UniqueEntityId.from(newSession.sessionId),
            occurredAt: startOccurredAt,
          },
          {
            sessionId: newSession.sessionId,
            visitorId: newSession.visitorId,
            deviceId: newSession.deviceId,
            journeyId: newSession.journeyId,
            source: newSession.source,
          },
        ),
        tx,
      );
      await this.deps.sessions.saveCurrent(newSession, input.tenantId, tx);

      const transitionId = this.deps.idGenerator.generate();
      const event = new SessionSplit(
        {
          eventId: this.deps.idGenerator.generate(),
          aggregateId: UniqueEntityId.from(transitionId),
          occurredAt: this.deps.clock.now(),
        },
        {
          transitionId,
          visitorId: existing.visitorId,
          fromSessionId: input.sessionId,
          toSessionId: input.newSessionId,
          reason: input.reason,
          actor: input.actor,
        },
      );
      await this.deps.journey.record(
        {
          id: transitionId,
          kind: "explicit_split",
          visitorId: existing.visitorId,
          fromSessionId: input.sessionId,
          toSessionId: input.newSessionId,
          reason: input.reason,
          actor: input.actor,
          occurredAt: input.splitAt,
        },
        input.tenantId,
        event,
        tx,
      );

      return ok({ transitionId, newSessionId: input.newSessionId });
    });
  }
}
