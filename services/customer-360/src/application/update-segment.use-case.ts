import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { validateExpressionStructure } from "@platform/expression";
import type { RuleSet } from "@platform/rules";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { BusinessRuleError, ValidationError, type DomainError } from "@platform/utils";
import { SegmentUpdated } from "../events/segment-updated.event";
import type { SegmentDefinition } from "../ports/segment-definition";
import type { SegmentDefinitionRegistry } from "../ports/segment-definition-registry";

export interface UpdateSegmentInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly id: string;
  readonly expectedVersion: number;
  readonly name?: string;
  readonly description?: string;
  readonly ruleSet?: RuleSet<boolean>;
}

export interface UpdateSegmentOutput {
  readonly definition: SegmentDefinition;
}

export interface UpdateSegmentDeps {
  readonly definitions: SegmentDefinitionRegistry;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Edits an existing segment definition's rule set and/or metadata — a CAS write (ADR-0060/D-042),
 * the same optimistic-concurrency discipline every other write path in this context follows. Bumps
 * `version`, which every `SegmentMembership` this definition later produces carries forward, so a
 * stored membership row can always be traced back to the exact rule-set version that computed it,
 * even after the definition is edited again.
 */
export class UpdateSegment implements UseCase<
  UpdateSegmentInput,
  UpdateSegmentOutput,
  DomainError
> {
  private readonly deps: UpdateSegmentDeps;

  constructor(deps: UpdateSegmentDeps) {
    this.deps = deps;
  }

  async execute(input: UpdateSegmentInput): Promise<Result<UpdateSegmentOutput, DomainError>> {
    const existing = await this.deps.definitions.getById(input.id, input.tenantId);
    if (existing === null) {
      return err(
        new BusinessRuleError(`Segment "${input.id}" does not exist`, {
          context: { id: input.id },
        }),
      );
    }

    if (input.ruleSet !== undefined) {
      const errors = input.ruleSet.rules.flatMap((rule) => validateExpressionStructure(rule.when));
      if (errors.length > 0) {
        return err(
          new ValidationError(`Segment "${input.id}" has an invalid rule set`, [
            { field: "ruleSet", message: JSON.stringify(errors) },
          ]),
        );
      }
    }

    const now = this.deps.clock.now().toISOString();
    const definition: SegmentDefinition = {
      id: existing.id,
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      version: existing.version + 1,
      ruleSet: input.ruleSet ?? existing.ruleSet,
      createdAt: existing.createdAt,
      updatedAt: now,
    };

    return this.deps.unitOfWork.run<Result<UpdateSegmentOutput, DomainError>>(async (tx) => {
      const event = new SegmentUpdated(
        {
          eventId: this.deps.idGenerator.generate(),
          aggregateId: UniqueEntityId.from(input.id),
          occurredAt: this.deps.clock.now(),
        },
        { segmentId: definition.id, name: definition.name, version: definition.version },
      );
      await this.deps.definitions.save(
        definition,
        input.tenantId,
        input.expectedVersion,
        event,
        tx,
      );
      return ok({ definition });
    });
  }
}
