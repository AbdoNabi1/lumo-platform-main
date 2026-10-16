import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { ReportDefinition } from "../domain/report-definition";
import type { ReportDefinitionRepository } from "../domain/repositories";

export interface ListReportDefinitionsInput extends CursorPage {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface ListReportDefinitionsDeps {
  readonly reportDefinitions: ReportDefinitionRepository;
}

/** Cursor-paginated report-definition listing. */
export class ListReportDefinitions implements UseCase<
  ListReportDefinitionsInput,
  Paginated<ReportDefinition>,
  DomainError
> {
  private readonly deps: ListReportDefinitionsDeps;

  constructor(deps: ListReportDefinitionsDeps) {
    this.deps = deps;
  }

  async execute(
    input: ListReportDefinitionsInput,
  ): Promise<Result<Paginated<ReportDefinition>, DomainError>> {
    const { tenantId, ...page } = input;
    return ok(await this.deps.reportDefinitions.list(page, tenantId));
  }
}
