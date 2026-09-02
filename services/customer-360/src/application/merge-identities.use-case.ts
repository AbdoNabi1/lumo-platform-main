import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { classifyEdge, type IdentityEdge } from "@platform/tracking";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import { IdentityMerged } from "../events/identity-merged.event";
import type { IdentifierRef } from "../ports/identity-decision";
import type { IdentityDecisionStore } from "../ports/identity-decision-store";
import type { IdentityGraphStore } from "../ports/identity-graph-store";

export interface MergeIdentitiesInput {
  readonly subject: IdentifierRef;
  readonly related: IdentifierRef;
  readonly reason: string;
  readonly actor: string;
}

export interface MergeIdentitiesOutput {
  readonly decisionId: string;
}

export interface MergeIdentitiesDeps {
  readonly graph: IdentityGraphStore;
  readonly decisions: IdentityDecisionStore;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Explicit, human/system-asserted link between two identifiers that were never observed together
 * (e.g. an operator confirming a guest checkout and a later account belong to the same person).
 * Records BOTH the new edge (so future resolution includes it) and the decision (so provenance —
 * who, why — survives, per FF-CDP-03) in one transaction.
 */
export class MergeIdentities implements UseCase<
  MergeIdentitiesInput,
  MergeIdentitiesOutput,
  DomainError
> {
  private readonly deps: MergeIdentitiesDeps;

  constructor(deps: MergeIdentitiesDeps) {
    this.deps = deps;
  }

  async execute(input: MergeIdentitiesInput): Promise<Result<MergeIdentitiesOutput, DomainError>> {
    if (input.subject.type === input.related.type && input.subject.value === input.related.value) {
      return err(
        new ValidationError("Cannot merge an identifier with itself", [
          { field: "related", message: "must differ from subject" },
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

    return this.deps.unitOfWork.run<Result<MergeIdentitiesOutput, DomainError>>(async (tx) => {
      const occurredAt = this.deps.clock.now();
      const decisionId = this.deps.idGenerator.generate();

      const edge: IdentityEdge = {
        fromType: input.subject.type,
        fromValue: input.subject.value,
        toType: input.related.type,
        toValue: input.related.value,
        confidence: classifyEdge(input.subject.type, input.related.type),
        observedAt: occurredAt.toISOString(),
        source: `manual_merge:${input.actor}`,
      };

      const event = new IdentityMerged(
        {
          eventId: this.deps.idGenerator.generate(),
          aggregateId: UniqueEntityId.from(decisionId),
          occurredAt,
        },
        {
          decisionId,
          subjectType: input.subject.type,
          subjectValue: input.subject.value,
          mergedType: input.related.type,
          mergedValue: input.related.value,
          reason: input.reason,
          actor: input.actor,
        },
      );

      await this.deps.graph.appendEdge(edge, undefined, tx);
      await this.deps.decisions.record(
        {
          id: decisionId,
          kind: "merge",
          subject: input.subject,
          related: input.related,
          reason: input.reason,
          actor: input.actor,
          occurredAt: occurredAt.toISOString(),
        },
        event,
        tx,
      );

      return ok({ decisionId });
    });
  }
}
