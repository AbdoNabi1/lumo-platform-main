import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { Experiment } from "../domain/experiment";
import type { ExperimentRepository } from "../domain/experiment-repository";
import type { ExperimentIdInput } from "./experiment.use-cases";

export interface GetExperimentDeps {
  readonly experiments: ExperimentRepository;
}

/** Fetches a single experiment by id. */
export class GetExperiment implements UseCase<ExperimentIdInput, Experiment, DomainError> {
  private readonly deps: GetExperimentDeps;

  constructor(deps: GetExperimentDeps) {
    this.deps = deps;
  }

  async execute(input: ExperimentIdInput): Promise<Result<Experiment, DomainError>> {
    const experiment = await this.deps.experiments.findById(input.experimentId);
    return experiment === null ? err(new NotFoundError("Experiment not found")) : ok(experiment);
  }
}
