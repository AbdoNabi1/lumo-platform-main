import type { CursorPage } from "@platform/types";
import type {
  AdvanceComponentDefinition,
  AdvanceComponentDefinitionInput,
  ComponentDefinitionIdInput,
  CreateComponentDefinition,
  CreateComponentDefinitionInput,
} from "../application/components.use-cases";
import type { GetComponentDefinition } from "../application/get-component-definition.use-case";
import type { ListComponentDefinitions } from "../application/list-component-definitions.use-case";
import { type ControllerResponse, present } from "./presenter";

export interface ComponentsControllerDeps {
  readonly createComponentDefinition: CreateComponentDefinition;
  readonly advanceComponentDefinition: AdvanceComponentDefinition;
  readonly listComponentDefinitions: ListComponentDefinitions;
  readonly getComponentDefinition: GetComponentDefinition;
}

/** Framework-agnostic interface boundary for components use-cases (no HTTP server). */
export class ComponentsController {
  private readonly deps: ComponentsControllerDeps;

  constructor(deps: ComponentsControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreateComponentDefinitionInput): Promise<ControllerResponse> {
    return present(await this.deps.createComponentDefinition.execute(input), 201);
  }

  async advance(input: AdvanceComponentDefinitionInput): Promise<ControllerResponse> {
    return present(await this.deps.advanceComponentDefinition.execute(input), 200);
  }

  async list(input: CursorPage): Promise<ControllerResponse> {
    return present(await this.deps.listComponentDefinitions.execute(input), 200);
  }

  async get(input: ComponentDefinitionIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getComponentDefinition.execute(input), 200);
  }
}
