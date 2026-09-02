import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type CursorPage, type Paginated, type Result } from "@platform/types";
import { type DomainError, ConflictError, NotFoundError } from "@platform/utils";
import { ContentBlock } from "../domain/content-block";
import type { ContentBlockRepository } from "../domain/repositories";
import { BlockBody, type BlockBodyFormat } from "../domain/value-objects/block-body";
import type { ContentStatusValue } from "../domain/value-objects/content-status";

export interface CreateContentBlockInput {
  readonly name: string;
  readonly blockType: string;
  readonly format: BlockBodyFormat;
  readonly content: string;
  readonly locale?: string;
}

export interface ContentStatusOutput {
  readonly contentBlockId: string;
  readonly status: string;
}

export interface ContentDeps {
  readonly blocks: ContentBlockRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Creates a content block in `draft` status — one per `name`. */
export class CreateContentBlock implements UseCase<
  CreateContentBlockInput,
  ContentStatusOutput,
  DomainError
> {
  private readonly deps: ContentDeps;

  constructor(deps: ContentDeps) {
    this.deps = deps;
  }

  async execute(input: CreateContentBlockInput): Promise<Result<ContentStatusOutput, DomainError>> {
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    return this.deps.unitOfWork.run<Result<ContentStatusOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.blocks.findByName(input.name, tx);
      if (existing !== null) {
        return err(new ConflictError(`Content block "${input.name}" already exists`));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const block = ContentBlock.create(
        id,
        input.name,
        input.blockType,
        BlockBody.create(input.format, input.content),
        input.locale,
      );
      await this.deps.blocks.save(block, tx);
      return ok({ contentBlockId: id.toString(), status: block.status.value });
    });
  }
}

export interface ContentBlockIdInput {
  readonly contentBlockId: string;
}

export interface AdvanceContentBlockInput extends ContentBlockIdInput {
  readonly toStatus: ContentStatusValue;
  readonly scheduledAt?: Date;
}

/** Generic validated transition — used for schedule/publish/archive. */
export class AdvanceContentBlock implements UseCase<
  AdvanceContentBlockInput,
  ContentStatusOutput,
  DomainError
> {
  private readonly deps: ContentDeps;

  constructor(deps: ContentDeps) {
    this.deps = deps;
  }

  async execute(
    input: AdvanceContentBlockInput,
  ): Promise<Result<ContentStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ContentStatusOutput, DomainError>>(async (tx) => {
      const block = await this.deps.blocks.findById(input.contentBlockId, tx);
      if (block === null) return err(new NotFoundError("Content block not found"));

      try {
        if (input.toStatus === "scheduled" && input.scheduledAt !== undefined) {
          block.schedule(
            input.scheduledAt,
            this.deps.idGenerator.generate(),
            this.deps.clock.now(),
          );
        } else {
          block.transition(input.toStatus, this.deps.idGenerator.generate(), this.deps.clock.now());
        }
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.blocks.save(block, tx);
      return ok({ contentBlockId: block.id.toString(), status: block.status.value });
    });
  }
}

export interface UpdateContentBodyInput extends ContentBlockIdInput {
  readonly format: BlockBodyFormat;
  readonly content: string;
}

/** Updates a content block's draft body. */
export class UpdateContentBody implements UseCase<
  UpdateContentBodyInput,
  ContentStatusOutput,
  DomainError
> {
  private readonly deps: ContentDeps;

  constructor(deps: ContentDeps) {
    this.deps = deps;
  }

  async execute(input: UpdateContentBodyInput): Promise<Result<ContentStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ContentStatusOutput, DomainError>>(async (tx) => {
      const block = await this.deps.blocks.findById(input.contentBlockId, tx);
      if (block === null) return err(new NotFoundError("Content block not found"));

      try {
        block.updateBody(BlockBody.create(input.format, input.content));
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.blocks.save(block, tx);
      return ok({ contentBlockId: block.id.toString(), status: block.status.value });
    });
  }
}

export interface ListContentBlocksDeps {
  readonly blocks: ContentBlockRepository;
}

/** Cursor-paginated content block listing, most recently created first (Phase A.30 admin Content screen). */
export class ListContentBlocks implements UseCase<
  CursorPage,
  Paginated<ContentBlock>,
  DomainError
> {
  private readonly deps: ListContentBlocksDeps;

  constructor(deps: ListContentBlocksDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<ContentBlock>, DomainError>> {
    return ok(await this.deps.blocks.list(input));
  }
}
