import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { ReportDefinition } from "../domain/report-definition";
import type { ReportDefinitionRepository } from "../domain/repositories";
import type { ReportDefinitionIdInput } from "./reporting.use-cases";

export interface GetReportDefinitionDeps {
  readonly reportDefinitions: ReportDefinitionRepository;
}

/** Fetches a single report definition by id. */
export class GetReportDefinition implements UseCase<
  ReportDefinitionIdInput,
  ReportDefinition,
  DomainError
> {
  private readonly deps: GetReportDefinitionDeps;

  constructor(deps: GetReportDefinitionDeps) {
    this.deps = deps;
  }

  async execute(input: ReportDefinitionIdInput): Promise<Result<ReportDefinition, DomainError>> {
    const definition = await this.deps.reportDefinitions.findById(
      input.reportDefinitionId,
      input.tenantId,
    );
    return definition === null
      ? err(new NotFoundError("Report definition not found"))
      : ok(definition);
  }
}
