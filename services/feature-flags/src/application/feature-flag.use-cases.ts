import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ConflictError, NotFoundError } from "@platform/utils";
import { FeatureFlag } from "../domain/feature-flag";
import type { FeatureFlagRepository } from "../domain/feature-flag-repository";
import { FeatureEnvironment } from "../domain/value-objects/feature-environment";
import { FeatureRule, type FeatureRuleType } from "../domain/value-objects/feature-rule";
import type { FlagStatusValue } from "../domain/value-objects/flag-status";

export interface CreateFeatureFlagInput {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface FlagStatusOutput {
  readonly flagId: string;
  readonly status: string;
  readonly rolloutPercentage: number;
}

export interface FlagIdInput {
  readonly flagId: string;
  /** ADR-0014: the caller's verified tenant. Shared by every input extending this one. */
  readonly tenantId: string;
}

export interface FeatureFlagDeps {
  readonly flags: FeatureFlagRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

function toOutput(flag: FeatureFlag): FlagStatusOutput {
  return {
    flagId: flag.id.toString(),
    status: flag.status.value,
    rolloutPercentage: flag.rolloutPercentage,
  };
}

/** Creates a feature flag in `active` status with a 0% rollout — one per `key`. */
export class CreateFeatureFlag implements UseCase<
  CreateFeatureFlagInput,
  FlagStatusOutput,
  DomainError
> {
  private readonly deps: FeatureFlagDeps;

  constructor(deps: FeatureFlagDeps) {
    this.deps = deps;
  }

  async execute(input: CreateFeatureFlagInput): Promise<Result<FlagStatusOutput, DomainError>> {
    const key = Guard.againstEmpty(input.key, "key");
    if (!key.ok) return err(key.error);

    return this.deps.unitOfWork.run<Result<FlagStatusOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.flags.findByKey(input.key, input.tenantId, tx);
      if (existing !== null) {
        return err(new ConflictError(`Feature flag "${input.key}" already exists`));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const flag = FeatureFlag.create(id, input.key, input.name, input.description);
      await this.deps.flags.save(flag, input.tenantId, tx);
      return ok(toOutput(flag));
    });
  }
}

export interface AdvanceFlagInput extends FlagIdInput {
  readonly toStatus: FlagStatusValue;
  readonly changedBy: string;
}

/** Generic validated transition — used for kill/revive/archive. */
export class AdvanceFlag implements UseCase<AdvanceFlagInput, FlagStatusOutput, DomainError> {
  private readonly deps: FeatureFlagDeps;

  constructor(deps: FeatureFlagDeps) {
    this.deps = deps;
  }

  async execute(input: AdvanceFlagInput): Promise<Result<FlagStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<FlagStatusOutput, DomainError>>(async (tx) => {
      const flag = await this.deps.flags.findById(input.flagId, input.tenantId, tx);
      if (flag === null) return err(new NotFoundError("Feature flag not found"));

      try {
        flag.transition(
          input.toStatus,
          input.changedBy,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.flags.save(flag, input.tenantId, tx);
      return ok(toOutput(flag));
    });
  }
}

export interface SetRolloutPercentageInput extends FlagIdInput {
  readonly percentage: number;
  readonly changedBy: string;
}

/** Sets the flag's deterministic rollout percentage (FNV bucket on `subjectId`). */
export class SetRolloutPercentage implements UseCase<
  SetRolloutPercentageInput,
  FlagStatusOutput,
  DomainError
> {
  private readonly deps: FeatureFlagDeps;

  constructor(deps: FeatureFlagDeps) {
    this.deps = deps;
  }

  async execute(input: SetRolloutPercentageInput): Promise<Result<FlagStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<FlagStatusOutput, DomainError>>(async (tx) => {
      const flag = await this.deps.flags.findById(input.flagId, input.tenantId, tx);
      if (flag === null) return err(new NotFoundError("Feature flag not found"));

      try {
        flag.setRolloutPercentage(
          input.percentage,
          input.changedBy,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.flags.save(flag, input.tenantId, tx);
      return ok(toOutput(flag));
    });
  }
}

export interface AddFeatureRuleInput extends FlagIdInput {
  readonly type: FeatureRuleType;
  readonly values: readonly string[];
  readonly enabled: boolean;
  readonly attribute?: string;
  readonly changedBy: string;
}

/** Adds a targeting rule to a flag. */
export class AddFeatureRule implements UseCase<AddFeatureRuleInput, FlagStatusOutput, DomainError> {
  private readonly deps: FeatureFlagDeps;

  constructor(deps: FeatureFlagDeps) {
    this.deps = deps;
  }

  async execute(input: AddFeatureRuleInput): Promise<Result<FlagStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<FlagStatusOutput, DomainError>>(async (tx) => {
      const flag = await this.deps.flags.findById(input.flagId, input.tenantId, tx);
      if (flag === null) return err(new NotFoundError("Feature flag not found"));

      const rule = FeatureRule.create(input.type, input.values, input.enabled, input.attribute);
      flag.addRule(rule, input.changedBy, this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.flags.save(flag, input.tenantId, tx);
      return ok(toOutput(flag));
    });
  }
}

export interface SetEnvironmentOverrideInput extends FlagIdInput {
  readonly environment: string;
  readonly enabled: boolean;
  readonly rolloutPercentage?: number;
  readonly changedBy: string;
}

/** Sets a per-environment override on a flag. */
export class SetEnvironmentOverride implements UseCase<
  SetEnvironmentOverrideInput,
  FlagStatusOutput,
  DomainError
> {
  private readonly deps: FeatureFlagDeps;

  constructor(deps: FeatureFlagDeps) {
    this.deps = deps;
  }

  async execute(
    input: SetEnvironmentOverrideInput,
  ): Promise<Result<FlagStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<FlagStatusOutput, DomainError>>(async (tx) => {
      const flag = await this.deps.flags.findById(input.flagId, input.tenantId, tx);
      if (flag === null) return err(new NotFoundError("Feature flag not found"));

      const environment = FeatureEnvironment.create(
        input.environment,
        input.enabled,
        input.rolloutPercentage,
      );
      flag.setEnvironmentOverride(
        environment,
        input.changedBy,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.flags.save(flag, input.tenantId, tx);
      return ok(toOutput(flag));
    });
  }
}
