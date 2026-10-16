import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import { SessionMerged } from "../events/session-merged.event";
import type { JourneyStore } from "../ports/journey-store";
import type { SessionStore } from "../ports/session-store";

export interface MergeSessionInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly fromSessionId: string;
  readonly toSessionId: string;
  readonly reason: string;
  readonly actor: string;
}

export interface MergeSessionOutput {
  readonly transitionId: string;
}

export interface MergeSessionDeps {
  readonly sessions: SessionStore;
  readonly journey: JourneyStore;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Explicit, provenance-carrying assertion that two independently tracked sessions belong to the
 * same continuous journey (e.g. an operator confirming a desktop session and a later mobile session
 * were the same shopping visit). Journey-graph-only — records an `explicit_merge` transition and
 * nothing else; it never mutates either session (unlike `SplitSession`, a merge does not truncate
 * or close anything) and it never touches the Identity Graph (`@platform/tracking`'s
 * `IdentityGraph`) or Identity Engine's own `IdentityLink`/`IdentityDecision` ledgers — "which
 * sessions form one journey" and "which identifiers belong to one person" are different questions,
 * resolved by different engines (the "never duplicate Identity Graph" rule, enforced here in code,
 * not just in documentation).
 */
export class MergeSession implements UseCase<MergeSessionInput, MergeSessionOutput, DomainError> {
  private readonly deps: MergeSessionDeps;

  constructor(deps: MergeSessionDeps) {
    this.deps = deps;
  }

  async execute(input: MergeSessionInput): Promise<Result<MergeSessionOutput, DomainError>> {
    if (input.fromSessionId === input.toSessionId) {
      return err(
        new ValidationError("Cannot merge a session with itself", [
          { field: "toSessionId", message: "must differ from fromSessionId" },
        ]),
      );
    }
    if (input.reason.trim() === "" || input.actor.trim() === "") {
      return err(
        new ValidationError("Merge requires a reason and an actor", [
          { field: "reason", message: "required" },
        ]),
      );
    }

    const [from, to] = await Promise.all([
      this.deps.sessions.getCurrent(input.fromSessionId, input.tenantId),
      this.deps.sessions.getCurrent(input.toSessionId, input.tenantId),
    ]);
    if (from === null || to === null) {
      return err(
        new ValidationError("Cannot merge sessions that were never observed", [
          { field: "fromSessionId", message: "both sessions must already exist" },
        ]),
      );
    }

    return this.deps.unitOfWork.run<Result<MergeSessionOutput, DomainError>>(async (tx) => {
      const transitionId = this.deps.idGenerator.generate();
      const event = new SessionMerged(
        {
          eventId: this.deps.idGenerator.generate(),
          aggregateId: UniqueEntityId.from(transitionId),
          occurredAt: this.deps.clock.now(),
        },
        {
          transitionId,
          visitorId: from.visitorId,
          fromSessionId: input.fromSessionId,
          toSessionId: input.toSessionId,
          reason: input.reason,
          actor: input.actor,
        },
      );

      await this.deps.journey.record(
        {
          id: transitionId,
          kind: "explicit_merge",
          visitorId: from.visitorId,
          fromSessionId: input.fromSessionId,
          toSessionId: input.toSessionId,
          reason: input.reason,
          actor: input.actor,
          occurredAt: this.deps.clock.now().toISOString(),
        },
        input.tenantId,
        event,
        tx,
      );

      return ok({ transitionId });
    });
  }
}
