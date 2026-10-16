import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ConflictError, NotFoundError } from "@platform/utils";
import { Experiment } from "../domain/experiment";
import type { ExperimentRepository } from "../domain/experiment-repository";
import {
  ExperimentAudience,
  Variant,
  validateAllocationsSum,
} from "../domain/value-objects/variant";
import type { ExperimentStatusValue } from "../domain/value-objects/experiment-status";

export interface CreateExperimentInput {
  readonly name: string;
  readonly hypothesis?: string;
  readonly variants: readonly { key: string; allocationPercentage: number; isControl: boolean }[];
  readonly goalMetricRef: string;
  readonly audiencePercentage?: number;
  readonly audienceSegmentRefs?: readonly string[];
  readonly featureFlagRef?: string;
  readonly tenantId: string;
}

export interface ExperimentStatusOutput {
  readonly experimentId: string;
  readonly status: string;
}

export interface ExperimentDeps {
  readonly experiments: ExperimentRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Creates an experiment in `draft` status — variant allocations must sum to 100. */
export class CreateExperiment implements UseCase<
  CreateExperimentInput,
  ExperimentStatusOutput,
  DomainError
> {
  private readonly deps: ExperimentDeps;

  constructor(deps: ExperimentDeps) {
    this.deps = deps;
  }

  async execute(
    input: CreateExperimentInput,
  ): Promise<Result<ExperimentStatusOutput, DomainError>> {
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    const variants: Variant[] = [];
    for (const v of input.variants) {
      const variant = Variant.create(v.key, v.allocationPercentage, v.isControl);
      if (!variant.ok) return err(variant.error);
      variants.push(variant.value);
    }
    const allocationCheck = validateAllocationsSum(variants);
    if (!allocationCheck.ok) return err(allocationCheck.error);

    return this.deps.unitOfWork.run<Result<ExperimentStatusOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.experiments.findByName(input.name, input.tenantId, tx);
      if (existing !== null) {
        return err(new ConflictError(`Experiment "${input.name}" already exists`));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const experiment = Experiment.create(
        id,
        input.name,
        variants,
        input.audiencePercentage === undefined
          ? ExperimentAudience.everyone()
          : ExperimentAudience.create(input.audiencePercentage, input.audienceSegmentRefs),
        input.goalMetricRef,
        input.hypothesis,
        input.featureFlagRef,
      );
      await this.deps.experiments.save(experiment, input.tenantId, tx);
      return ok({ experimentId: id.toString(), status: experiment.status.value });
    });
  }
}

export interface ExperimentIdInput {
  readonly experimentId: string;
  readonly tenantId: string;
}

export interface AdvanceExperimentInput extends ExperimentIdInput {
  readonly toStatus: ExperimentStatusValue;
}

/** Generic validated transition — used for start/pause/resume/complete/archive. */
export class AdvanceExperiment implements UseCase<
  AdvanceExperimentInput,
  ExperimentStatusOutput,
  DomainError
> {
  private readonly deps: ExperimentDeps;

  constructor(deps: ExperimentDeps) {
    this.deps = deps;
  }

  async execute(
    input: AdvanceExperimentInput,
  ): Promise<Result<ExperimentStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ExperimentStatusOutput, DomainError>>(async (tx) => {
      const experiment = await this.deps.experiments.findById(
        input.experimentId,
        input.tenantId,
        tx,
      );
      if (experiment === null) return err(new NotFoundError("Experiment not found"));

      try {
        experiment.transition(
          input.toStatus,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.experiments.save(experiment, input.tenantId, tx);
      return ok({ experimentId: experiment.id.toString(), status: experiment.status.value });
    });
  }
}

export interface RecordResultInput extends ExperimentIdInput {
  readonly variantKey: string;
  readonly metricValue: number;
  readonly sampleSize: number;
}

/** Records a metric observation for a variant. */
export class RecordExperimentResult implements UseCase<
  RecordResultInput,
  ExperimentStatusOutput,
  DomainError
> {
  private readonly deps: ExperimentDeps;

  constructor(deps: ExperimentDeps) {
    this.deps = deps;
  }

  async execute(input: RecordResultInput): Promise<Result<ExperimentStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ExperimentStatusOutput, DomainError>>(async (tx) => {
      const experiment = await this.deps.experiments.findById(
        input.experimentId,
        input.tenantId,
        tx,
      );
      if (experiment === null) return err(new NotFoundError("Experiment not found"));

      try {
        experiment.recordResult(
          input.variantKey,
          input.metricValue,
          input.sampleSize,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.experiments.save(experiment, input.tenantId, tx);
      return ok({ experimentId: experiment.id.toString(), status: experiment.status.value });
    });
  }
}

export interface DeclareWinnerInput extends ExperimentIdInput {
  readonly variantKey: string;
}

/** Declares the winning variant. */
export class DeclareWinner implements UseCase<
  DeclareWinnerInput,
  ExperimentStatusOutput,
  DomainError
> {
  private readonly deps: ExperimentDeps;

  constructor(deps: ExperimentDeps) {
    this.deps = deps;
  }

  async execute(input: DeclareWinnerInput): Promise<Result<ExperimentStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ExperimentStatusOutput, DomainError>>(async (tx) => {
      const experiment = await this.deps.experiments.findById(
        input.experimentId,
        input.tenantId,
        tx,
      );
      if (experiment === null) return err(new NotFoundError("Experiment not found"));

      try {
        experiment.declareWinner(
          input.variantKey,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.experiments.save(experiment, input.tenantId, tx);
      return ok({ experimentId: experiment.id.toString(), status: experiment.status.value });
    });
  }
}
