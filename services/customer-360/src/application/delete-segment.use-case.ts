import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { BusinessRuleError, type DomainError } from "@platform/utils";
import { SegmentDeleted } from "../events/segment-deleted.event";
import type { SegmentDefinitionRegistry } from "../ports/segment-definition-registry";

export interface DeleteSegmentInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly id: string;
  readonly expectedVersion: number;
}

export interface DeleteSegmentOutput {
  readonly deleted: boolean;
}

export interface DeleteSegmentDeps {
  readonly definitions: SegmentDefinitionRegistry;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Removes a segment definition from future evaluation — a CAS delete (ADR-0060/D-042). Never
 * cascades into `SegmentMembership`/`SegmentHistory` rows: this context is append-only/never-delete
 * everywhere else, and a definition is the one genuinely deletable aggregate in it
 * (`SEGMENTATION_MODEL.md` §2). Existing membership/history rows for the deleted segment simply stop
 * being produced going forward — they are not retroactively erased.
 */
export class DeleteSegment implements UseCase<
  DeleteSegmentInput,
  DeleteSegmentOutput,
  DomainError
> {
  private readonly deps: DeleteSegmentDeps;

  constructor(deps: DeleteSegmentDeps) {
    this.deps = deps;
  }

  async execute(input: DeleteSegmentInput): Promise<Result<DeleteSegmentOutput, DomainError>> {
    const existing = await this.deps.definitions.getById(input.id, input.tenantId);
    if (existing === null) {
      return err(
        new BusinessRuleError(`Segment "${input.id}" does not exist`, {
          context: { id: input.id },
        }),
      );
    }

    return this.deps.unitOfWork.run<Result<DeleteSegmentOutput, DomainError>>(async (tx) => {
      const event = new SegmentDeleted(
        {
          eventId: this.deps.idGenerator.generate(),
          aggregateId: UniqueEntityId.from(input.id),
          occurredAt: this.deps.clock.now(),
        },
        { segmentId: input.id, version: existing.version },
      );
      await this.deps.definitions.delete(
        input.id,
        input.expectedVersion,
        input.tenantId,
        event,
        tx,
      );
      return ok({ deleted: true });
    });
  }
}
