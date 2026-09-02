import type { CursorPage, Paginated } from "@platform/types";
import type { AnalyticsReport } from "./analytics-report";
import type { Dashboard } from "./dashboard";
import type { ReportDefinition } from "./report-definition";

/** Persistence port for {@link ReportDefinition}. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface ReportDefinitionRepository {
  save(definition: ReportDefinition, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<ReportDefinition | null>;
  findByName(name: string, tx?: unknown): Promise<ReportDefinition | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<ReportDefinition>>;
}

/** Persistence port for {@link Dashboard}. */
export interface DashboardRepository {
  save(dashboard: Dashboard, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Dashboard | null>;
  findByName(name: string, tx?: unknown): Promise<Dashboard | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<Dashboard>>;
}

/** Persistence port for {@link AnalyticsReport} — write-once run records. */
export interface AnalyticsReportRepository {
  save(report: AnalyticsReport, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<AnalyticsReport | null>;
}
