import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Dashboard } from "../domain/dashboard";
import type { DashboardRepository } from "../domain/repositories";

export interface ListDashboardsInput extends CursorPage {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface ListDashboardsDeps {
  readonly dashboards: DashboardRepository;
}

/** Cursor-paginated dashboard listing. */
export class ListDashboards implements UseCase<
  ListDashboardsInput,
  Paginated<Dashboard>,
  DomainError
> {
  private readonly deps: ListDashboardsDeps;

  constructor(deps: ListDashboardsDeps) {
    this.deps = deps;
  }

  async execute(input: ListDashboardsInput): Promise<Result<Paginated<Dashboard>, DomainError>> {
    const { tenantId, ...page } = input;
    return ok(await this.deps.dashboards.list(page, tenantId));
  }
}
