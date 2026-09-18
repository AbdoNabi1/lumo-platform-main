import type { GetDashboard } from "../application/get-dashboard.use-case";
import type { GetReportDefinition } from "../application/get-report-definition.use-case";
import type { ListDashboards, ListDashboardsInput } from "../application/list-dashboards.use-case";
import type {
  ListReportDefinitions,
  ListReportDefinitionsInput,
} from "../application/list-report-definitions.use-case";
import type {
  AdvanceDashboard,
  AdvanceDashboardInput,
  AdvanceReportDefinition,
  AdvanceReportDefinitionInput,
  CreateDashboard,
  CreateDashboardInput,
  CreateReportDefinition,
  CreateReportDefinitionInput,
  DashboardIdInput,
  GenerateReport,
  GenerateReportInput,
  ReportDefinitionIdInput,
} from "../application/reporting.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface ReportingControllerDeps {
  readonly createReportDefinition: CreateReportDefinition;
  readonly advanceReportDefinition: AdvanceReportDefinition;
  readonly generateReport: GenerateReport;
  readonly createDashboard: CreateDashboard;
  readonly advanceDashboard: AdvanceDashboard;
  readonly listReportDefinitions: ListReportDefinitions;
  readonly getReportDefinition: GetReportDefinition;
  readonly listDashboards: ListDashboards;
  readonly getDashboard: GetDashboard;
}

/** Framework-agnostic interface boundary for reporting use-cases (no HTTP server). */
export class ReportingController {
  private readonly deps: ReportingControllerDeps;

  constructor(deps: ReportingControllerDeps) {
    this.deps = deps;
  }

  async createReportDefinition(input: CreateReportDefinitionInput): Promise<ControllerResponse> {
    return present(await this.deps.createReportDefinition.execute(input), 201);
  }

  async advanceReportDefinition(input: AdvanceReportDefinitionInput): Promise<ControllerResponse> {
    return present(await this.deps.advanceReportDefinition.execute(input), 200);
  }

  async generateReport(input: GenerateReportInput): Promise<ControllerResponse> {
    return present(await this.deps.generateReport.execute(input), 200);
  }

  async createDashboard(input: CreateDashboardInput): Promise<ControllerResponse> {
    return present(await this.deps.createDashboard.execute(input), 201);
  }

  async advanceDashboard(input: AdvanceDashboardInput): Promise<ControllerResponse> {
    return present(await this.deps.advanceDashboard.execute(input), 200);
  }

  async listReportDefinitions(input: ListReportDefinitionsInput): Promise<ControllerResponse> {
    return present(await this.deps.listReportDefinitions.execute(input), 200);
  }

  async getReportDefinition(input: ReportDefinitionIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getReportDefinition.execute(input), 200);
  }

  async listDashboards(input: ListDashboardsInput): Promise<ControllerResponse> {
    return present(await this.deps.listDashboards.execute(input), 200);
  }

  async getDashboard(input: DashboardIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getDashboard.execute(input), 200);
  }
}
