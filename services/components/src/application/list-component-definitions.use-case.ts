import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { ComponentDefinition } from "../domain/component-definition";
import type { ComponentDefinitionRepository } from "../domain/repositories";

export interface ListComponentDefinitionsDeps {
  readonly definitions: ComponentDefinitionRepository;
}

/** Cursor-paginated component-definition listing. */
export class ListComponentDefinitions
  implements UseCase<CursorPage, Paginated<ComponentDefinition>, DomainError>
{
  private readonly deps: ListComponentDefinitionsDeps;

  constructor(deps: ListComponentDefinitionsDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<ComponentDefinition>, DomainError>> {
    return ok(await this.deps.definitions.list(input));
  }
}
