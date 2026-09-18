import type { Principal } from "@platform/contracts";
import type { ReportingController } from "@platform/reporting";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface ReportingAdminControllerDeps {
  readonly reporting: ReportingController;
  readonly guard: AdminGuard;
}

/** Wires the Reporting admin screen to the Reporting context (Sprint S1). Pure delegation; every action authorizes first (RBAC seam, ADR-0007). */
export class ReportingAdminController {
  private readonly reporting: ReportingController;
  private readonly guard: AdminGuard;

  constructor(deps: ReportingAdminControllerDeps) {
    this.reporting = deps.reporting;
    this.guard = deps.guard;
  }

  async createReportDefinition(
    principal: Principal,
    input: Parameters<ReportingController["createReportDefinition"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "reporting:create_report_definition");
    if (denied) return denied;
    return this.reporting.createReportDefinition(input);
  }

  async advanceReportDefinition(
    principal: Principal,
    input: Parameters<ReportingController["advanceReportDefinition"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "reporting:advance_report_definition");
    if (denied) return denied;
    return this.reporting.advanceReportDefinition(input);
  }

  async generateReport(
    principal: Principal,
    input: Parameters<ReportingController["generateReport"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "reporting:generate_report");
    if (denied) return denied;
    return this.reporting.generateReport(input);
  }

  async createDashboard(
    principal: Principal,
    input: Parameters<ReportingController["createDashboard"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "reporting:create_dashboard");
    if (denied) return denied;
    return this.reporting.createDashboard(input);
  }

  async advanceDashboard(
    principal: Principal,
    input: Parameters<ReportingController["advanceDashboard"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "reporting:advance_dashboard");
    if (denied) return denied;
    return this.reporting.advanceDashboard(input);
  }

  async listReportDefinitions(
    principal: Principal,
    input: Parameters<ReportingController["listReportDefinitions"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "reporting:read");
    if (denied) return denied;
    return this.reporting.listReportDefinitions(input);
  }

  async getReportDefinition(
    principal: Principal,
    input: Parameters<ReportingController["getReportDefinition"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "reporting:read");
    if (denied) return denied;
    return this.reporting.getReportDefinition(input);
  }

  async listDashboards(
    principal: Principal,
    input: Parameters<ReportingController["listDashboards"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "reporting:read");
    if (denied) return denied;
    return this.reporting.listDashboards(input);
  }

  async getDashboard(
    principal: Principal,
    input: Parameters<ReportingController["getDashboard"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "reporting:read");
    if (denied) return denied;
    return this.reporting.getDashboard(input);
  }
}
