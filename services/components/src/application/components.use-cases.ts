import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ConflictError, NotFoundError } from "@platform/utils";
import { ComponentDefinition, type ComponentStatusValue } from "../domain/component-definition";
import type { ComponentDefinitionRepository } from "../domain/repositories";
import { ComponentContract } from "../domain/value-objects/component-contract";
import { ComponentSchema, type ComponentProperty } from "../domain/value-objects/component-schema";

export interface CreateComponentDefinitionInput {
  readonly key: string;
  readonly name: string;
  readonly properties: readonly ComponentProperty[];
  readonly defaults?: Readonly<Record<string, unknown>>;
  readonly slots: readonly string[];
  readonly events: readonly string[];
  readonly responsive: boolean;
  readonly permission?: string;
  readonly featureFlagKey?: string;
  readonly tenantId: string;
}

export interface ComponentStatusOutput {
  readonly componentDefinitionId: string;
  readonly status: string;
}

export interface ComponentsDeps {
  readonly definitions: ComponentDefinitionRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Creates a component definition in `draft` status — one per `key`. */
export class CreateComponentDefinition implements UseCase<
  CreateComponentDefinitionInput,
  ComponentStatusOutput,
  DomainError
> {
  private readonly deps: ComponentsDeps;

  constructor(deps: ComponentsDeps) {
    this.deps = deps;
  }

  async execute(
    input: CreateComponentDefinitionInput,
  ): Promise<Result<ComponentStatusOutput, DomainError>> {
    const key = Guard.againstEmpty(input.key, "key");
    if (!key.ok) return err(key.error);

    return this.deps.unitOfWork.run<Result<ComponentStatusOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.definitions.findByKey(input.key, input.tenantId, tx);
      if (existing !== null) {
        return err(new ConflictError(`Component "${input.key}" already exists`));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const definition = ComponentDefinition.create(
        id,
        input.key,
        input.name,
        ComponentSchema.create(input.properties, input.defaults),
        ComponentContract.create({
          slots: input.slots,
          events: input.events,
          responsive: input.responsive,
          permission: input.permission,
        }),
        input.featureFlagKey,
      );
      await this.deps.definitions.save(definition, tx);
      return ok({ componentDefinitionId: id.toString(), status: definition.status });
    });
  }
}

export interface ComponentDefinitionIdInput {
  readonly componentDefinitionId: string;
  readonly tenantId: string;
}

export interface AdvanceComponentDefinitionInput extends ComponentDefinitionIdInput {
  readonly toStatus: ComponentStatusValue;
}

/** Generic validated transition — used for publish/deprecate/archive. */
export class AdvanceComponentDefinition implements UseCase<
  AdvanceComponentDefinitionInput,
  ComponentStatusOutput,
  DomainError
> {
  private readonly deps: ComponentsDeps;

  constructor(deps: ComponentsDeps) {
    this.deps = deps;
  }

  async execute(
    input: AdvanceComponentDefinitionInput,
  ): Promise<Result<ComponentStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ComponentStatusOutput, DomainError>>(async (tx) => {
      const definition = await this.deps.definitions.findById(
        input.componentDefinitionId,
        input.tenantId,
        tx,
      );
      if (definition === null) return err(new NotFoundError("Component definition not found"));

      try {
        definition.transition(
          input.toStatus,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.definitions.save(definition, tx);
      return ok({ componentDefinitionId: definition.id.toString(), status: definition.status });
    });
  }
}
