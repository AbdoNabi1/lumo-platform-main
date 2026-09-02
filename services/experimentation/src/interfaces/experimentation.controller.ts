import type { CursorPage } from "@platform/types";
import type {
  AdvanceExperiment,
  AdvanceExperimentInput,
  CreateExperiment,
  CreateExperimentInput,
  DeclareWinner,
  DeclareWinnerInput,
  ExperimentIdInput,
  RecordExperimentResult,
  RecordResultInput,
} from "../application/experiment.use-cases";
import type { GetExperiment } from "../application/get-experiment.use-case";
import type { ListExperiments } from "../application/list-experiments.use-case";
import { type ControllerResponse, present } from "./presenter";

export interface ExperimentationControllerDeps {
  readonly createExperiment: CreateExperiment;
  readonly advanceExperiment: AdvanceExperiment;
  readonly recordResult: RecordExperimentResult;
  readonly declareWinner: DeclareWinner;
  readonly listExperiments: ListExperiments;
  readonly getExperiment: GetExperiment;
}

/** Framework-agnostic interface boundary for experimentation use-cases (no HTTP server). */
export class ExperimentationController {
  private readonly deps: ExperimentationControllerDeps;

  constructor(deps: ExperimentationControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreateExperimentInput): Promise<ControllerResponse> {
    return present(await this.deps.createExperiment.execute(input), 201);
  }

  async advance(input: AdvanceExperimentInput): Promise<ControllerResponse> {
    return present(await this.deps.advanceExperiment.execute(input), 200);
  }

  async recordResult(input: RecordResultInput): Promise<ControllerResponse> {
    return present(await this.deps.recordResult.execute(input), 200);
  }

  async declareWinner(input: DeclareWinnerInput): Promise<ControllerResponse> {
    return present(await this.deps.declareWinner.execute(input), 200);
  }

  async list(input: CursorPage): Promise<ControllerResponse> {
    return present(await this.deps.listExperiments.execute(input), 200);
  }

  async get(input: ExperimentIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getExperiment.execute(input), 200);
  }
}
