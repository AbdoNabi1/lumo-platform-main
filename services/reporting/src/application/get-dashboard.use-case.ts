import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { Dashboard } from "../domain/dashboard";
import type { DashboardRepository } from "../domain/repositories";
import type { DashboardIdInput } from "./reporting.use-cases";

export interface GetDashboardDeps {
  readonly dashboards: DashboardRepository;
}

/** Fetches a single dashboard by id. */
export class GetDashboard implements UseCase<DashboardIdInput, Dashboard, DomainError> {
  private readonly deps: GetDashboardDeps;

  constructor(deps: GetDashboardDeps) {
    this.deps = deps;
  }

  async execute(input: DashboardIdInput): Promise<Result<Dashboard, DomainError>> {
    const dashboard = await this.deps.dashboards.findById(input.dashboardId);
    return dashboard === null ? err(new NotFoundError("Dashboard not found")) : ok(dashboard);
  }
}
