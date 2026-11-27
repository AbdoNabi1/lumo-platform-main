import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import {
  BusinessRuleError,
  ConcurrencyError,
  ConflictError,
  type DomainError,
  NotFoundError,
  ValidationError,
  type FieldIssue,
} from "@platform/utils";
import {
  CustomerSegment,
  DEFAULT_SEGMENTS,
  isDefaultSegmentId,
  MAX_CUSTOM_SEGMENTS,
  MAX_SEGMENT_NAME_LENGTH,
  parseSegmentConditions,
  type DefaultSegment,
  type SegmentCondition,
} from "../domain/customer-segment";
import type { CustomerSegmentRepository } from "../domain/customer-segment-repository";

export interface SegmentView {
  readonly id: string;
  readonly kind: "default" | "custom";
  readonly key: string | null;
  readonly name: string | null;
  readonly version: number | null;
  readonly conditions: readonly SegmentCondition[];
  readonly updatedAt: string | null;
}
export interface ListCustomerSegmentsInput {
  readonly tenantId: string;
}
export interface ListCustomerSegmentsOutput {
  readonly items: readonly SegmentView[];
}
export interface GetCustomerSegmentInput {
  readonly tenantId: string;
  readonly segmentId: string;
}
export type GetCustomerSegmentOutput = SegmentView;
export interface CreateCustomerSegmentInput {
  readonly tenantId: string;
  readonly name: string;
  readonly conditions: unknown;
  readonly createdBy: string | null;
}
export interface CreateCustomerSegmentOutput {
  readonly segmentId: string;
}
export interface UpdateCustomerSegmentInput {
  readonly tenantId: string;
  readonly segmentId: string;
  readonly expectedVersion: number;
  readonly name?: string;
  readonly conditions?: unknown;
}
export interface UpdateCustomerSegmentOutput {
  readonly segmentId: string;
  readonly version: number;
}
export interface DeleteCustomerSegmentInput {
  readonly tenantId: string;
  readonly segmentId: string;
  readonly expectedVersion: number;
}
export interface DeleteCustomerSegmentOutput {
  readonly segmentId: string;
}
type ReadDeps = { readonly segments: CustomerSegmentRepository };
type WriteDeps = ReadDeps & { readonly unitOfWork: TransactionalUnitOfWork<unknown> };
type ResultOf<T> = Result<T, DomainError>;
const defaultView = (s: DefaultSegment): SegmentView => ({
  id: s.id,
  kind: "default",
  key: s.key,
  name: null,
  version: null,
  conditions: s.conditions,
  updatedAt: null,
});
const customView = (s: CustomerSegment): SegmentView => ({
  id: s.id.toString(),
  kind: "custom",
  key: null,
  name: s.name,
  version: s.version,
  conditions: s.conditions,
  updatedAt: s.updatedAt.toISOString(),
});
const conflict = () => new ConflictError("This segment was changed by someone else");
const defaultError = () => new BusinessRuleError("Default segments can't be changed");
const missing = () => new NotFoundError("Segment not found");
function validate(
  name: unknown,
  conditions: unknown,
  hasName: boolean,
  hasConditions: boolean,
): Result<{ name?: string; conditions?: readonly SegmentCondition[] }, ValidationError> {
  const issues: FieldIssue[] = [];
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (hasName && (!trimmed || [...trimmed].length > MAX_SEGMENT_NAME_LENGTH))
    issues.push({ field: "name", message: "must be 1 to 100 characters" });
  const parsed = hasConditions ? parseSegmentConditions(conditions) : undefined;
  if (parsed && !parsed.ok) issues.push(...parsed.error.fields);
  if (issues.length) return err(new ValidationError("Invalid segment", issues));
  return ok({
    ...(hasName ? { name: trimmed } : {}),
    ...(parsed?.ok ? { conditions: parsed.value } : {}),
  });
}
export class ListCustomerSegments implements UseCase<
  ListCustomerSegmentsInput,
  ListCustomerSegmentsOutput,
  DomainError
> {
  constructor(private readonly deps: ReadDeps) {}
  async execute(input: ListCustomerSegmentsInput): Promise<ResultOf<ListCustomerSegmentsOutput>> {
    return ok({
      items: [
        ...DEFAULT_SEGMENTS.map(defaultView),
        ...(await this.deps.segments.list(input.tenantId)).map(customView),
      ],
    });
  }
}
export class GetCustomerSegment implements UseCase<
  GetCustomerSegmentInput,
  GetCustomerSegmentOutput,
  DomainError
> {
  constructor(private readonly deps: ReadDeps) {}
  async execute(input: GetCustomerSegmentInput): Promise<ResultOf<SegmentView>> {
    const d = DEFAULT_SEGMENTS.find((s) => s.id === input.segmentId);
    if (d) return ok(defaultView(d));
    const row = await this.deps.segments.findById(input.segmentId, input.tenantId);
    return row ? ok(customView(row)) : err(missing());
  }
}
export class CreateCustomerSegment implements UseCase<
  CreateCustomerSegmentInput,
  CreateCustomerSegmentOutput,
  DomainError
> {
  constructor(
    private readonly deps: WriteDeps & { readonly idGenerator: IdGenerator; readonly clock: Clock },
  ) {}
  async execute(input: CreateCustomerSegmentInput): Promise<ResultOf<CreateCustomerSegmentOutput>> {
    const checked = validate(input.name, input.conditions, true, true);
    if (!checked.ok) return err(checked.error);
    try {
      return await this.deps.unitOfWork.run<ResultOf<CreateCustomerSegmentOutput>>(async (tx) =>
        this.deps.segments.withTenantSegmentsLock(
          input.tenantId,
          async () => {
            if ((await this.deps.segments.count(input.tenantId, tx)) >= MAX_CUSTOM_SEGMENTS)
              return err(new BusinessRuleError("A store can have at most 100 segments"));
            const id = UniqueEntityId.from(this.deps.idGenerator.generate());
            const segment = CustomerSegment.create(
              id,
              checked.value.name!,
              checked.value.conditions!,
              input.createdBy,
              this.deps.clock.now(),
            );
            await this.deps.segments.save(segment, input.tenantId, tx);
            return ok({ segmentId: id.toString() });
          },
          tx,
        ),
      );
    } catch (error) {
      if (error instanceof ConflictError) return err(error);
      throw error;
    }
  }
}
export class UpdateCustomerSegment implements UseCase<
  UpdateCustomerSegmentInput,
  UpdateCustomerSegmentOutput,
  DomainError
> {
  constructor(private readonly deps: WriteDeps & { readonly clock: Clock }) {}
  async execute(input: UpdateCustomerSegmentInput): Promise<ResultOf<UpdateCustomerSegmentOutput>> {
    if (isDefaultSegmentId(input.segmentId)) return err(defaultError());
    const hasName = input.name !== undefined,
      hasConditions = input.conditions !== undefined;
    if (!hasName && !hasConditions)
      return err(
        new ValidationError("Invalid segment", [
          { field: "body", message: "must contain a change" },
        ]),
      );
    const checked = validate(input.name, input.conditions, hasName, hasConditions);
    if (!checked.ok) return err(checked.error);
    try {
      return await this.deps.unitOfWork.run<ResultOf<UpdateCustomerSegmentOutput>>(async (tx) => {
        const segment = await this.deps.segments.findById(input.segmentId, input.tenantId, tx);
        if (!segment) return err(missing());
        if (segment.version !== input.expectedVersion) return err(conflict());
        const now = this.deps.clock.now();
        if (checked.value.name !== undefined) segment.rename(checked.value.name, now);
        if (checked.value.conditions !== undefined)
          segment.replaceConditions(checked.value.conditions, now);
        const version = await this.deps.segments.save(segment, input.tenantId, tx);
        return ok({ segmentId: input.segmentId, version });
      });
    } catch (error) {
      if (error instanceof ConcurrencyError) return err(conflict());
      if (error instanceof ConflictError) return err(error);
      throw error;
    }
  }
}
export class DeleteCustomerSegment implements UseCase<
  DeleteCustomerSegmentInput,
  DeleteCustomerSegmentOutput,
  DomainError
> {
  constructor(private readonly deps: WriteDeps) {}
  async execute(input: DeleteCustomerSegmentInput): Promise<ResultOf<DeleteCustomerSegmentOutput>> {
    if (isDefaultSegmentId(input.segmentId)) return err(defaultError());
    return this.deps.unitOfWork.run<ResultOf<DeleteCustomerSegmentOutput>>(async (tx) => {
      const status = await this.deps.segments.delete(
        input.segmentId,
        input.expectedVersion,
        input.tenantId,
        tx,
      );
      return status === "deleted"
        ? ok({ segmentId: input.segmentId })
        : err(status === "stale" ? conflict() : missing());
    });
  }
}
