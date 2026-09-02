import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import { openSession } from "../domain/customer-session";
import { toSnapshot } from "../domain/session-snapshot";
import { SessionStarted } from "../events/session-started.event";
import type { JourneyStore } from "../ports/journey-store";
import type { SessionHistoryStore } from "../ports/session-history-store";
import type { SessionStore } from "../ports/session-store";

export interface ResumeSessionInput {
  /** The prior, already-closed session this activity continues. */
  readonly closedSessionId: string;
  /** The new session id to open — minted by the caller (typically the tracking SDK's own rotated
   * `session_id`), never a reuse of `closedSessionId` (a closed session is never reopened). */
  readonly sessionId: string;
  readonly visitorId: string;
  readonly deviceId?: string;
  readonly journeyId?: string;
  readonly source?: string;
  readonly occurredAt: string;
}

export interface ResumeSessionOutput {
  readonly sessionId: string;
  readonly transitionId: string;
}

export interface ResumeSessionDeps {
  readonly sessions: SessionStore;
  readonly history: SessionHistoryStore;
  readonly journey: JourneyStore;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Opens a new session explicitly linked to a prior *closed* one via a `resumed` transition — used
 * when a caller has additional context (short gap, same device fingerprint, same visitor) that
 * justifies asserting continuity beyond what `ObserveSession`'s own organic path infers on its own.
 * `ObserveSession` treats a closed `sessionId` reappearing as a brand-new, unlinked session
 * precisely because it has no such context; `ResumeSession` is how a caller upgrades that judgment
 * call into a recorded journey edge. `resumed` does not require `reason`/`actor` — unlike
 * `explicit_merge`/`explicit_split`, it is not a correction, just an organic continuity signal (see
 * `session-transition.ts`'s `requiresProvenance`).
 */
export class ResumeSession implements UseCase<
  ResumeSessionInput,
  ResumeSessionOutput,
  DomainError
> {
  private readonly deps: ResumeSessionDeps;

  constructor(deps: ResumeSessionDeps) {
    this.deps = deps;
  }

  async execute(input: ResumeSessionInput): Promise<Result<ResumeSessionOutput, DomainError>> {
    if (
      input.closedSessionId.trim() === "" ||
      input.sessionId.trim() === "" ||
      input.visitorId.trim() === ""
    ) {
      return err(
        new ValidationError(
          "Resuming a session requires closedSessionId, sessionId and visitorId",
          [{ field: "closedSessionId", message: "required" }],
        ),
      );
    }
    if (input.closedSessionId === input.sessionId) {
      return err(
        new ValidationError("A resumed session must have a different id from the closed one", [
          { field: "sessionId", message: "must differ from closedSessionId" },
        ]),
      );
    }

    const closed = await this.deps.sessions.getCurrent(input.closedSessionId);
    if (closed === null || closed.status !== "closed") {
      return err(
        new ValidationError("Can only resume a session that has been closed", [
          { field: "closedSessionId", message: "no matching closed session found" },
        ]),
      );
    }

    return this.deps.unitOfWork.run<Result<ResumeSessionOutput, DomainError>>(async (tx) => {
      const session = openSession({
        sessionId: input.sessionId,
        visitorId: input.visitorId,
        deviceId: input.deviceId,
        journeyId: input.journeyId,
        source: input.source,
        startedAt: input.occurredAt,
      });

      const occurredAt = this.deps.clock.now();
      const snapshot = toSnapshot(session, "started", occurredAt.toISOString());
      const event = new SessionStarted(
        {
          eventId: this.deps.idGenerator.generate(),
          aggregateId: UniqueEntityId.from(session.sessionId),
          occurredAt,
        },
        {
          sessionId: session.sessionId,
          visitorId: session.visitorId,
          deviceId: session.deviceId,
          journeyId: session.journeyId,
          source: session.source,
        },
      );
      await this.deps.history.append(snapshot, event, tx);
      await this.deps.sessions.saveCurrent(session, tx);

      const transitionId = this.deps.idGenerator.generate();
      await this.deps.journey.record(
        {
          id: transitionId,
          kind: "resumed",
          visitorId: input.visitorId,
          fromSessionId: input.closedSessionId,
          toSessionId: input.sessionId,
          occurredAt: input.occurredAt,
        },
        undefined,
        tx,
      );

      return ok({ sessionId: session.sessionId, transitionId });
    });
  }
}
