import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ConflictError, NotFoundError } from "@platform/utils";
import { AnalyticsReport } from "../domain/analytics-report";
import { Dashboard } from "../domain/dashboard";
import { ReportDefinition } from "../domain/report-definition";
import type {
  AnalyticsReportRepository,
  DashboardRepository,
  ReportDefinitionRepository,
} from "../domain/repositories";
import {
  AnalyticsDimensionSelection,
  AnalyticsMetricSelection,
  CronSchedule,
  ReportFilter,
  type FilterOperator,
  type ReportType,
} from "../domain/value-objects/report-selection";
import type {
  DashboardStatusValue,
  ReportDefinitionStatusValue,
} from "../domain/value-objects/statuses";
import type { AnalyticsQueryPort } from "./ports";

export interface ReportingDeps {
  readonly reportDefinitions: ReportDefinitionRepository;
  readonly dashboards: DashboardRepository;
  readonly analyticsReports: AnalyticsReportRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface CreateReportDefinitionInput {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
  readonly name: string;
  readonly type: ReportType;
  readonly metricRefs: readonly string[];
  readonly dimensionRefs?: readonly string[];
  readonly filters?: readonly { field: string; operator: FilterOperator; value: unknown }[];
  readonly cronExpression?: string;
}

export interface ReportDefinitionStatusOutput {
  readonly reportDefinitionId: string;
  readonly status: string;
}

/** Creates a report definition in `draft` status. */
export class CreateReportDefinition implements UseCase<
  CreateReportDefinitionInput,
  ReportDefinitionStatusOutput,
  DomainError
> {
  private readonly deps: ReportingDeps;

  constructor(deps: ReportingDeps) {
    this.deps = deps;
  }

  async execute(
    input: CreateReportDefinitionInput,
  ): Promise<Result<ReportDefinitionStatusOutput, DomainError>> {
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    return this.deps.unitOfWork.run<Result<ReportDefinitionStatusOutput, DomainError>>(
      async (tx) => {
        const existing = await this.deps.reportDefinitions.findByName(
          input.name,
          input.tenantId,
          tx,
        );
        if (existing !== null) {
          return err(new ConflictError(`Report definition "${input.name}" already exists`));
        }
        const id = UniqueEntityId.from(this.deps.idGenerator.generate());
        const definition = ReportDefinition.create(
          id,
          input.name,
          input.type,
          input.metricRefs.map((ref) => AnalyticsMetricSelection.create(ref)),
          (input.dimensionRefs ?? []).map((ref) => AnalyticsDimensionSelection.create(ref)),
          (input.filters ?? []).map((f) => ReportFilter.create(f.field, f.operator, f.value)),
          input.cronExpression === undefined
            ? undefined
            : CronSchedule.create(input.cronExpression),
        );
        await this.deps.reportDefinitions.save(definition, input.tenantId, tx);
        return ok({ reportDefinitionId: id.toString(), status: definition.status.value });
      },
    );
  }
}

export interface ReportDefinitionIdInput {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
  readonly reportDefinitionId: string;
}

export interface AdvanceReportDefinitionInput extends ReportDefinitionIdInput {
  readonly toStatus: ReportDefinitionStatusValue;
}

/** Generic validated transition — used for activate/archive. */
export class AdvanceReportDefinition implements UseCase<
  AdvanceReportDefinitionInput,
  ReportDefinitionStatusOutput,
  DomainError
> {
  private readonly deps: ReportingDeps;

  constructor(deps: ReportingDeps) {
    this.deps = deps;
  }

  async execute(
    input: AdvanceReportDefinitionInput,
  ): Promise<Result<ReportDefinitionStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ReportDefinitionStatusOutput, DomainError>>(
      async (tx) => {
        const definition = await this.deps.reportDefinitions.findById(
          input.reportDefinitionId,
          input.tenantId,
          tx,
        );
        if (definition === null) return err(new NotFoundError("Report definition not found"));

        try {
          definition.transition(
            input.toStatus,
            this.deps.idGenerator.generate(),
            this.deps.clock.now(),
          );
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }

        await this.deps.reportDefinitions.save(definition, input.tenantId, tx);
        return ok({
          reportDefinitionId: definition.id.toString(),
          status: definition.status.value,
        });
      },
    );
  }
}

export type GenerateReportInput = ReportDefinitionIdInput;

export interface GenerateReportOutput {
  readonly reportId: string;
  readonly outcome: string;
}

export interface GenerateReportDeps extends ReportingDeps {
  readonly analytics: AnalyticsQueryPort;
}

/** Generates a run of a report definition through `AnalyticsQueryPort` — never a direct business query. */
export class GenerateReport implements UseCase<
  GenerateReportInput,
  GenerateReportOutput,
  DomainError
> {
  private readonly deps: GenerateReportDeps;

  constructor(deps: GenerateReportDeps) {
    this.deps = deps;
  }

  async execute(input: GenerateReportInput): Promise<Result<GenerateReportOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<GenerateReportOutput, DomainError>>(async (tx) => {
      const definition = await this.deps.reportDefinitions.findById(
        input.reportDefinitionId,
        input.tenantId,
        tx,
      );
      if (definition === null) return err(new NotFoundError("Report definition not found"));

      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      let report: AnalyticsReport;
      try {
        const resultData = await this.deps.analytics.run(
          definition.metrics.map((m) => m.metricRef),
          definition.dimensions.map((d) => d.dimensionRef),
          definition.filters.map((f) => ({ field: f.field, operator: f.operator, value: f.value })),
        );
        report = AnalyticsReport.recordSuccess(
          id,
          definition.id.toString(),
          resultData,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        report = AnalyticsReport.recordFailure(
          id,
          definition.id.toString(),
          error instanceof Error ? error.message : "report generation failed",
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      }

      await this.deps.analyticsReports.save(report, input.tenantId, tx);
      return ok({ reportId: id.toString(), outcome: report.outcome });
    });
  }
}

export interface CreateDashboardInput {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
  readonly name: string;
  readonly tileRefs: readonly string[];
}

export interface DashboardStatusOutput {
  readonly dashboardId: string;
  readonly status: string;
}

/** Creates a dashboard in `active` status. */
export class CreateDashboard implements UseCase<
  CreateDashboardInput,
  DashboardStatusOutput,
  DomainError
> {
  private readonly deps: ReportingDeps;

  constructor(deps: ReportingDeps) {
    this.deps = deps;
  }

  async execute(input: CreateDashboardInput): Promise<Result<DashboardStatusOutput, DomainError>> {
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    return this.deps.unitOfWork.run<Result<DashboardStatusOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.dashboards.findByName(input.name, input.tenantId, tx);
      if (existing !== null) {
        return err(new ConflictError(`Dashboard "${input.name}" already exists`));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const dashboard = Dashboard.create(id, input.name, input.tileRefs);
      await this.deps.dashboards.save(dashboard, input.tenantId, tx);
      return ok({ dashboardId: id.toString(), status: dashboard.status.value });
    });
  }
}

export interface DashboardIdInput {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
  readonly dashboardId: string;
}

export interface AdvanceDashboardInput extends DashboardIdInput {
  readonly toStatus: DashboardStatusValue;
}

/** Generic validated transition — used for archive/reactivate. */
export class AdvanceDashboard implements UseCase<
  AdvanceDashboardInput,
  DashboardStatusOutput,
  DomainError
> {
  private readonly deps: ReportingDeps;

  constructor(deps: ReportingDeps) {
    this.deps = deps;
  }

  async execute(input: AdvanceDashboardInput): Promise<Result<DashboardStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<DashboardStatusOutput, DomainError>>(async (tx) => {
      const dashboard = await this.deps.dashboards.findById(input.dashboardId, input.tenantId, tx);
      if (dashboard === null) return err(new NotFoundError("Dashboard not found"));

      try {
        dashboard.transition(
          input.toStatus,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.dashboards.save(dashboard, input.tenantId, tx);
      return ok({ dashboardId: dashboard.id.toString(), status: dashboard.status.value });
    });
  }
}
