import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Experiment } from "../domain/experiment";
import type { ExperimentRepository } from "../domain/experiment-repository";

export interface ListExperimentsDeps {
  readonly experiments: ExperimentRepository;
}

/** Cursor-paginated experiment listing. */
export class ListExperiments implements UseCase<CursorPage, Paginated<Experiment>, DomainError> {
  private readonly deps: ListExperimentsDeps;

  constructor(deps: ListExperimentsDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<Experiment>, DomainError>> {
    return ok(await this.deps.experiments.list(input));
  }
}
