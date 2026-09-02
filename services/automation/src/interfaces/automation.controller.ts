import type { CursorPage } from "@platform/types";
import type {
  AdvanceWorkflow,
  AdvanceWorkflowInput,
  CreateWorkflow,
  CreateWorkflowInput,
  ListWorkflows,
  RetryExecution,
  RetryExecutionInput,
  TriggerWorkflow,
  TriggerWorkflowInput,
} from "../application/automation.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface AutomationControllerDeps {
  readonly createWorkflow: CreateWorkflow;
  readonly advanceWorkflow: AdvanceWorkflow;
  readonly triggerWorkflow: TriggerWorkflow;
  readonly retryExecution: RetryExecution;
  readonly listWorkflows: ListWorkflows;
}

/** Framework-agnostic interface boundary for automation use-cases (no HTTP server). */
export class AutomationController {
  private readonly deps: AutomationControllerDeps;

  constructor(deps: AutomationControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreateWorkflowInput): Promise<ControllerResponse> {
    return present(await this.deps.createWorkflow.execute(input), 201);
  }

  async advance(input: AdvanceWorkflowInput): Promise<ControllerResponse> {
    return present(await this.deps.advanceWorkflow.execute(input), 200);
  }

  async trigger(input: TriggerWorkflowInput): Promise<ControllerResponse> {
    return present(await this.deps.triggerWorkflow.execute(input), 200);
  }

  async retryExecution(input: RetryExecutionInput): Promise<ControllerResponse> {
    return present(await this.deps.retryExecution.execute(input), 200);
  }

  async list(input: CursorPage): Promise<ControllerResponse> {
    return present(await this.deps.listWorkflows.execute(input), 200);
  }
}
