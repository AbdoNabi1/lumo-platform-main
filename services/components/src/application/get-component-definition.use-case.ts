import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { ComponentDefinitionIdInput } from "./components.use-cases";
import type { ComponentDefinition } from "../domain/component-definition";
import type { ComponentDefinitionRepository } from "../domain/repositories";

export interface GetComponentDefinitionDeps {
  readonly definitions: ComponentDefinitionRepository;
}

/** Fetches a single component definition by id. */
export class GetComponentDefinition
  implements UseCase<ComponentDefinitionIdInput, ComponentDefinition, DomainError>
{
  private readonly deps: GetComponentDefinitionDeps;

  constructor(deps: GetComponentDefinitionDeps) {
    this.deps = deps;
  }

  async execute(
    input: ComponentDefinitionIdInput,
  ): Promise<Result<ComponentDefinition, DomainError>> {
    const definition = await this.deps.definitions.findById(input.componentDefinitionId);
    return definition === null
      ? err(new NotFoundError("Component definition not found"))
      : ok(definition);
  }
}
