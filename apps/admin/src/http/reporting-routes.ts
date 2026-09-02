import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { Dashboard, ReportDefinition } from "@platform/reporting";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const pageQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});

export interface ReportDefinitionDto {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly metricRefs: readonly string[];
  readonly dimensionRefs: readonly string[];
  readonly filters: readonly { field: string; operator: string; value: unknown }[];
  readonly cronExpression: string | null;
  readonly status: string;
}

function toReportDefinitionDto(definition: ReportDefinition): ReportDefinitionDto {
  return {
    id: definition.id.toString(),
    name: definition.name,
    type: definition.type,
    metricRefs: definition.metrics.map((m) => m.metricRef),
    dimensionRefs: definition.dimensions.map((d) => d.dimensionRef),
    filters: definition.filters.map((f) => ({
      field: f.field,
      operator: f.operator,
      value: f.value,
    })),
    cronExpression: definition.schedule?.expression ?? null,
    status: definition.status.value,
  };
}

export interface DashboardDto {
  readonly id: string;
  readonly name: string;
  readonly tileRefs: readonly string[];
  readonly status: string;
}

function toDashboardDto(dashboard: Dashboard): DashboardDto {
  return {
    id: dashboard.id.toString(),
    name: dashboard.name,
    tileRefs: dashboard.tileRefs,
    status: dashboard.status.value,
  };
}

const createReportDefinitionBody = z.object({
  name: z.string().min(1),
  type: z.enum(["table", "funnel", "cohort", "attribution", "custom"]),
  metricRefs: z.array(z.string().min(1)).min(1),
  dimensionRefs: z.array(z.string().min(1)).optional(),
  filters: z
    .array(
      z.object({
        field: z.string().min(1),
        operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in"]),
        value: z.unknown(),
      }),
    )
    .optional(),
  cronExpression: z.string().min(1).optional(),
});
const reportDefinitionIdParams = z.object({ reportDefinitionId: z.string().min(1) });
const advanceReportDefinitionBody = z.object({
  toStatus: z.enum(["draft", "active", "archived"]),
});
const createDashboardBody = z.object({
  name: z.string().min(1),
  tileRefs: z.array(z.string().min(1)),
});
const dashboardIdParams = z.object({ dashboardId: z.string().min(1) });
const advanceDashboardBody = z.object({ toStatus: z.enum(["active", "archived"]) });

/** The Reporting admin HTTP surface (Sprint S1). Pure delegation. */
export function reportingRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/reporting/report-definitions",
      version: 1,
      permission: "reporting:create_report_definition",
      idempotent: true,
      summary: "Create a report definition",
      schema: { body: createReportDefinitionBody },
      handle: ({ body, context }) =>
        admin.reporting.createReportDefinition(context.principal, {
          ...body,
          filters: body.filters?.map((f) => ({
            field: f.field,
            operator: f.operator,
            value: f.value,
          })),
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/reporting/report-definitions/:reportDefinitionId/transitions",
      version: 1,
      permission: "reporting:advance_report_definition",
      idempotent: true,
      summary: "Advance a report definition's status (activate/archive)",
      schema: { params: reportDefinitionIdParams, body: advanceReportDefinitionBody },
      handle: ({ params, body, context }) =>
        admin.reporting.advanceReportDefinition(context.principal, {
          reportDefinitionId: params.reportDefinitionId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/reporting/report-definitions/:reportDefinitionId/generate",
      version: 1,
      permission: "reporting:generate_report",
      summary: "Generate a run of a report definition via AnalyticsQueryPort",
      schema: { params: reportDefinitionIdParams },
      handle: ({ params, context }) =>
        admin.reporting.generateReport(context.principal, {
          reportDefinitionId: params.reportDefinitionId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/reporting/dashboards",
      version: 1,
      permission: "reporting:create_dashboard",
      idempotent: true,
      summary: "Create a dashboard",
      schema: { body: createDashboardBody },
      handle: ({ body, context }) => admin.reporting.createDashboard(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/reporting/dashboards/:dashboardId/transitions",
      version: 1,
      permission: "reporting:advance_dashboard",
      idempotent: true,
      summary: "Advance a dashboard's status (archive/reactivate)",
      schema: { params: dashboardIdParams, body: advanceDashboardBody },
      handle: ({ params, body, context }) =>
        admin.reporting.advanceDashboard(context.principal, {
          dashboardId: params.dashboardId,
          ...body,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/reporting/report-definitions",
      version: 1,
      permission: "reporting:read",
      summary: "List report definitions (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(
          await admin.reporting.listReportDefinitions(context.principal, query),
          toReportDefinitionDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/reporting/report-definitions/:reportDefinitionId",
      version: 1,
      permission: "reporting:read",
      summary: "Get one report definition by id",
      schema: { params: reportDefinitionIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.reporting.getReportDefinition(context.principal, params);
        if (response.status !== 200) return response;
        return { status: 200, body: toReportDefinitionDto(response.body as ReportDefinition) };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/reporting/dashboards",
      version: 1,
      permission: "reporting:read",
      summary: "List dashboards (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(await admin.reporting.listDashboards(context.principal, query), toDashboardDto),
    }),
    defineRoute({
      method: "GET",
      path: "/reporting/dashboards/:dashboardId",
      version: 1,
      permission: "reporting:read",
      summary: "Get one dashboard by id",
      schema: { params: dashboardIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.reporting.getDashboard(context.principal, params);
        if (response.status !== 200) return response;
        return { status: 200, body: toDashboardDto(response.body as Dashboard) };
      },
    }),
  ] as readonly RouteDefinition[];
}
