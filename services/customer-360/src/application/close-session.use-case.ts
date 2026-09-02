import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import { closeSession } from "../domain/customer-session";
import type { SessionCloseReason } from "../domain/session-boundary";
import { toSnapshot } from "../domain/session-snapshot";
import { SessionClosed } from "../events/session-closed.event";
import type { SessionHistoryStore } from "../ports/session-history-store";
import type { SessionStore } from "../ports/session-store";

export interface CloseSessionInput {
  readonly sessionId: string;
  /** `"timeout"` is deliberately excluded here — that reason is only ever assigned by
   * `ObserveSession`'s own idle-window rollover, never by an explicit caller. */
  readonly reason: Exclude<SessionCloseReason, "timeout">;
  readonly occurredAt: string;
}

export interface CloseSessionOutput {
  readonly sessionId: string;
}

export interface CloseSessionDeps {
  readonly sessions: SessionStore;
  readonly history: SessionHistoryStore;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Explicitly closes an open session — a manual logout signal, a detected browser restart, or a
 * detected device change (Rules: "Support: ... device changes, browser restart, ... manual
 * logout"). Distinct from `ObserveSession`'s own lazy timeout close: this is caller-driven, not a
 * byproduct of the next activity's idle-gap check.
 */
export class CloseSession implements UseCase<CloseSessionInput, CloseSessionOutput, DomainError> {
  private readonly deps: CloseSessionDeps;

  constructor(deps: CloseSessionDeps) {
    this.deps = deps;
  }

  async execute(input: CloseSessionInput): Promise<Result<CloseSessionOutput, DomainError>> {
    if (input.sessionId.trim() === "") {
      return err(
        new ValidationError("Closing a session requires a sessionId", [
          { field: "sessionId", message: "required" },
        ]),
      );
    }

    const existing = await this.deps.sessions.getCurrent(input.sessionId);
    if (existing === null) {
      return err(
        new ValidationError("Cannot close a session that was never observed", [
          { field: "sessionId", message: "no matching session found" },
        ]),
      );
    }
    if (existing.status === "closed") {
      return err(
        new ValidationError("Cannot close a session that is already closed", [
          { field: "sessionId", message: "already closed" },
        ]),
      );
    }

    return this.deps.unitOfWork.run<Result<CloseSessionOutput, DomainError>>(async (tx) => {
      const closed = closeSession(existing, input.reason, input.occurredAt);
      const occurredAt = this.deps.clock.now();
      const snapshot = toSnapshot(closed, "closed", occurredAt.toISOString());
      const event = new SessionClosed(
        {
          eventId: this.deps.idGenerator.generate(),
          aggregateId: UniqueEntityId.from(closed.sessionId),
          occurredAt,
        },
        {
          sessionId: closed.sessionId,
          closeReason: closed.closeReason ?? input.reason,
          pageCount: closed.pageCount,
        },
      );

      await this.deps.history.append(snapshot, event, tx);
      await this.deps.sessions.saveCurrent(closed, tx);

      return ok({ sessionId: closed.sessionId });
    });
  }
}
