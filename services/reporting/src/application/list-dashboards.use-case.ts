import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Dashboard } from "../domain/dashboard";
import type { DashboardRepository } from "../domain/repositories";

export interface ListDashboardsDeps {
  readonly dashboards: DashboardRepository;
}

/** Cursor-paginated dashboard listing. */
export class ListDashboards implements UseCase<CursorPage, Paginated<Dashboard>, DomainError> {
  private readonly deps: ListDashboardsDeps;

  constructor(deps: ListDashboardsDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<Dashboard>, DomainError>> {
    return ok(await this.deps.dashboards.list(input));
  }
}
