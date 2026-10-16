import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { validateExpressionStructure, type ExpressionStructureError } from "@platform/expression";
import type { RuleSet } from "@platform/rules";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { BusinessRuleError, ValidationError, type DomainError } from "@platform/utils";
import { SegmentCreated } from "../events/segment-created.event";
import {
  INITIAL_SEGMENT_DEFINITION_VERSION,
  type SegmentDefinition,
} from "../ports/segment-definition";
import type { SegmentDefinitionRegistry } from "../ports/segment-definition-registry";

export interface CreateSegmentInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly ruleSet: RuleSet<boolean>;
}

export interface CreateSegmentOutput {
  readonly definition: SegmentDefinition;
}

export interface CreateSegmentDeps {
  readonly definitions: SegmentDefinitionRegistry;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Every rule's condition, structurally validated (`@platform/expression`'s
 * `validateExpressionStructure`, reused not reimplemented) — a malformed rule is rejected at
 * authoring time, never discovered later at evaluation time. */
function validateRuleSet(ruleSet: RuleSet<boolean>): readonly ExpressionStructureError[] {
  const errors: ExpressionStructureError[] = [];
  for (const rule of ruleSet.rules) {
    errors.push(...validateExpressionStructure(rule.when));
  }
  return errors;
}

/**
 * Authors a new segment definition — the write path `AttributeDefinitionRegistry` never needed
 * (Computed Attribute definitions are seed-only; `SEGMENTATION_MODEL.md` §2). The definition is
 * created with `version: 1` and CAS-guarded with `expectedVersion:
 * INITIAL_SEGMENT_DEFINITION_VERSION` — a concurrent `CreateSegment` racing for the same id loses,
 * exactly the "0 means no row must exist yet" convention `AttributeStore`'s own create branch
 * establishes.
 */
export class CreateSegment implements UseCase<
  CreateSegmentInput,
  CreateSegmentOutput,
  DomainError
> {
  private readonly deps: CreateSegmentDeps;

  constructor(deps: CreateSegmentDeps) {
    this.deps = deps;
  }

  async execute(input: CreateSegmentInput): Promise<Result<CreateSegmentOutput, DomainError>> {
    const existing = await this.deps.definitions.getById(input.id, input.tenantId);
    if (existing !== null) {
      return err(
        new BusinessRuleError(`Segment "${input.id}" already exists`, {
          context: { id: input.id },
        }),
      );
    }

    const structureErrors = validateRuleSet(input.ruleSet);
    if (structureErrors.length > 0) {
      return err(
        new ValidationError(`Segment "${input.id}" has an invalid rule set`, [
          { field: "ruleSet", message: JSON.stringify(structureErrors) },
        ]),
      );
    }

    const now = this.deps.clock.now().toISOString();
    const definition: SegmentDefinition = {
      id: input.id,
      name: input.name,
      description: input.description,
      version: 1,
      ruleSet: input.ruleSet,
      createdAt: now,
      updatedAt: now,
    };

    return this.deps.unitOfWork.run<Result<CreateSegmentOutput, DomainError>>(async (tx) => {
      const event = new SegmentCreated(
        {
          eventId: this.deps.idGenerator.generate(),
          aggregateId: UniqueEntityId.from(input.id),
          occurredAt: this.deps.clock.now(),
        },
        { segmentId: input.id, name: input.name, version: 1 },
      );
      await this.deps.definitions.save(
        definition,
        input.tenantId,
        INITIAL_SEGMENT_DEFINITION_VERSION,
        event,
        tx,
      );
      return ok({ definition });
    });
  }
}
