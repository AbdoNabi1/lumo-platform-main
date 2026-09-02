import { UniqueEntityId } from "@platform/domain";
import { AnalyticsReport, type AnalyticsReportOutcome } from "../domain/analytics-report";
import { Dashboard } from "../domain/dashboard";
import { ReportDefinition } from "../domain/report-definition";
import {
  AnalyticsDimensionSelection,
  AnalyticsMetricSelection,
  CronSchedule,
  ReportFilter,
  type FilterOperator,
  type ReportType,
} from "../domain/value-objects/report-selection";
import {
  DashboardStatus,
  ReportDefinitionStatus,
  type DashboardStatusValue,
  type ReportDefinitionStatusValue,
} from "../domain/value-objects/statuses";

export interface ReportDefinitionRow {
  readonly id: string;
  readonly name: string;
  readonly type: ReportType;
  readonly metrics: readonly { metricRef: string; customExpression?: string }[];
  readonly dimensions: readonly { dimensionRef: string }[];
  readonly filters: readonly { field: string; operator: FilterOperator; value: unknown }[];
  readonly cronExpression: string | null;
  readonly status: string;
  readonly version: number;
}

export interface DashboardRow {
  readonly id: string;
  readonly name: string;
  readonly tileRefs: readonly string[];
  readonly status: string;
  readonly version: number;
}

export interface AnalyticsReportRow {
  readonly id: string;
  readonly reportDefinitionRef: string;
  readonly outcome: AnalyticsReportOutcome;
  readonly resultData: unknown;
  readonly errorMessage: string | null;
  readonly generatedAt: Date;
  readonly version: number;
}

/** Persistence ↔ aggregate mapping for {@link ReportDefinition}, {@link Dashboard}, {@link AnalyticsReport}. Mapping only — no I/O. */
export class ReportDefinitionMapper {
  static toDomain(row: ReportDefinitionRow): ReportDefinition {
    return ReportDefinition.reconstitute(
      UniqueEntityId.from(row.id),
      row.name,
      row.type,
      row.metrics.map((m) => AnalyticsMetricSelection.create(m.metricRef, m.customExpression)),
      row.dimensions.map((d) => AnalyticsDimensionSelection.create(d.dimensionRef)),
      row.filters.map((f) => ReportFilter.create(f.field, f.operator, f.value)),
      ReportDefinitionStatus.from(row.status as ReportDefinitionStatusValue),
      row.version,
      row.cronExpression === null ? undefined : CronSchedule.create(row.cronExpression),
    );
  }

  static toRow(definition: ReportDefinition, tenantId: string) {
    return {
      id: definition.id.toString(),
      tenantId,
      name: definition.name,
      type: definition.type,
      metrics: definition.metrics.map((m) => ({
        metricRef: m.metricRef,
        customExpression: m.customExpression,
      })),
      dimensions: definition.dimensions.map((d) => ({ dimensionRef: d.dimensionRef })),
      filters: definition.filters.map((f) => ({
        field: f.field,
        operator: f.operator,
        value: f.value,
      })),
      cronExpression: definition.schedule?.expression ?? null,
      status: definition.status.value,
      version: 1,
    };
  }
}

export class DashboardMapper {
  static toDomain(row: DashboardRow): Dashboard {
    return Dashboard.reconstitute(
      UniqueEntityId.from(row.id),
      row.name,
      row.tileRefs,
      DashboardStatus.from(row.status as DashboardStatusValue),
      row.version,
    );
  }

  static toRow(dashboard: Dashboard, tenantId: string) {
    return {
      id: dashboard.id.toString(),
      tenantId,
      name: dashboard.name,
      tileRefs: dashboard.tileRefs,
      status: dashboard.status.value,
      version: 1,
    };
  }
}

export class AnalyticsReportMapper {
  static toDomain(row: AnalyticsReportRow): AnalyticsReport {
    return AnalyticsReport.reconstitute(
      UniqueEntityId.from(row.id),
      row.reportDefinitionRef,
      row.outcome,
      row.generatedAt,
      row.version,
      row.resultData,
      row.errorMessage ?? undefined,
    );
  }

  static toRow(report: AnalyticsReport, tenantId: string) {
    return {
      id: report.id.toString(),
      tenantId,
      reportDefinitionRef: report.reportDefinitionRef,
      outcome: report.outcome,
      resultData: report.resultData ?? null,
      errorMessage: report.errorMessage ?? null,
      generatedAt: report.generatedAt,
      version: 1,
    };
  }
}
