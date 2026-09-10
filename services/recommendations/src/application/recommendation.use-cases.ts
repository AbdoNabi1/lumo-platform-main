import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ConflictError, NotFoundError } from "@platform/utils";
import { RecommendationModel } from "../domain/recommendation-model";
import type { RecommendationModelRepository } from "../domain/recommendation-model-repository";
import { RecommendationStrategy } from "../domain/value-objects/recommendation-strategy";
import type { ScoredProductRef } from "../domain/value-objects/recommendation-set";
import type { ModelStatusValue } from "../domain/value-objects/model-status";
import type { ProcessedInteractionStore, SearchQueryPort } from "./ports";

export interface CreateModelInput {
  readonly name: string;
  readonly strategy: string;
  readonly tenantId: string;
}

export interface ModelStatusOutput {
  readonly modelId: string;
  readonly status: string;
  readonly setCount: number;
}

export interface ModelIdInput {
  readonly modelId: string;
  readonly tenantId: string;
}

export interface ModelDeps {
  readonly models: RecommendationModelRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

function toOutput(model: RecommendationModel): ModelStatusOutput {
  return { modelId: model.id.toString(), status: model.status.value, setCount: model.sets.length };
}

/** Creates a recommendation model in `draft` status. */
export class CreateModel implements UseCase<CreateModelInput, ModelStatusOutput, DomainError> {
  private readonly deps: ModelDeps;

  constructor(deps: ModelDeps) {
    this.deps = deps;
  }

  async execute(input: CreateModelInput): Promise<Result<ModelStatusOutput, DomainError>> {
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);
    const strategy = RecommendationStrategy.create(input.strategy);
    if (!strategy.ok) return err(strategy.error);

    return this.deps.unitOfWork.run<Result<ModelStatusOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.models.findByName(input.name, input.tenantId, tx);
      if (existing !== null) {
        return err(new ConflictError(`Recommendation model "${input.name}" already exists`));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const model = RecommendationModel.create(id, input.name, strategy.value);
      await this.deps.models.save(model, tx);
      return ok(toOutput(model));
    });
  }
}

export interface AdvanceModelInput extends ModelIdInput {
  readonly toStatus: ModelStatusValue;
}

/** Generic validated transition — used for startTraining/activate/retire. */
export class AdvanceModel implements UseCase<AdvanceModelInput, ModelStatusOutput, DomainError> {
  private readonly deps: ModelDeps;

  constructor(deps: ModelDeps) {
    this.deps = deps;
  }

  async execute(input: AdvanceModelInput): Promise<Result<ModelStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ModelStatusOutput, DomainError>>(async (tx) => {
      const model = await this.deps.models.findById(input.modelId, input.tenantId, tx);
      if (model === null) return err(new NotFoundError("Recommendation model not found"));

      try {
        model.transition(input.toStatus, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.models.save(model, tx);
      return ok(toOutput(model));
    });
  }
}

export interface GenerateSetInput extends ModelIdInput {
  readonly interactionId: string;
  readonly anchorRef: string;
}

export interface GenerateSetDeps extends ModelDeps {
  readonly search: SearchQueryPort;
  readonly processedInteractions: ProcessedInteractionStore;
}

/** Event-driven generation from an interaction event — replay-safe by `interactionId`, idempotent by anchor. */
export class GenerateRecommendationSet implements UseCase<
  GenerateSetInput,
  ModelStatusOutput,
  DomainError
> {
  private readonly deps: GenerateSetDeps;

  constructor(deps: GenerateSetDeps) {
    this.deps = deps;
  }

  async execute(input: GenerateSetInput): Promise<Result<ModelStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ModelStatusOutput, DomainError>>(async (tx) => {
      const model = await this.deps.models.findById(input.modelId, input.tenantId, tx);
      if (model === null) return err(new NotFoundError("Recommendation model not found"));

      const alreadyProcessed = await this.deps.processedInteractions.hasProcessed(
        input.interactionId,
      );
      if (alreadyProcessed) return ok(toOutput(model));

      const relatedRefs = await this.deps.search.getRelatedProducts(input.anchorRef);
      const scoredRefs: ScoredProductRef[] = relatedRefs.map((productRef, index) => ({
        productRef,
        score: 1 / (index + 1),
      }));

      try {
        model.generate(
          input.anchorRef,
          scoredRefs,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.models.save(model, tx);
      await this.deps.processedInteractions.markProcessed(input.interactionId);
      return ok(toOutput(model));
    });
  }
}

export interface RegenerateSetInput extends ModelIdInput {
  readonly anchorRef: string;
}

export interface RegenerateSetDeps extends ModelDeps {
  readonly search: SearchQueryPort;
}

/** Forces a regeneration for an anchor — idempotent by anchor (overwrites). */
export class RegenerateRecommendationSet implements UseCase<
  RegenerateSetInput,
  ModelStatusOutput,
  DomainError
> {
  private readonly deps: RegenerateSetDeps;

  constructor(deps: RegenerateSetDeps) {
    this.deps = deps;
  }

  async execute(input: RegenerateSetInput): Promise<Result<ModelStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ModelStatusOutput, DomainError>>(async (tx) => {
      const model = await this.deps.models.findById(input.modelId, input.tenantId, tx);
      if (model === null) return err(new NotFoundError("Recommendation model not found"));

      const relatedRefs = await this.deps.search.getRelatedProducts(input.anchorRef);
      const scoredRefs: ScoredProductRef[] = relatedRefs.map((productRef, index) => ({
        productRef,
        score: 1 / (index + 1),
      }));

      try {
        model.regenerate(
          input.anchorRef,
          scoredRefs,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.models.save(model, tx);
      return ok(toOutput(model));
    });
  }
}
