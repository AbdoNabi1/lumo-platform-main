import { z } from "zod";
import {
  MetricDefinition,
  type Aggregation,
  type DimensionDefinition,
  type Metric,
  type MetricExpression,
  type MetricUnit,
} from "@platform/analytics";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

const metricIdParams = z.object({ id: z.string().min(1) });
const dimensionIdParams = z.object({ id: z.string().min(1) });

/**
 * `AnalyticsConsoleController` presents raw domain `Metric`/`DimensionDefinition` value objects
 * (see its own doc comment — Analytics has no `interfaces/` DTO layer of its own). `ValueObject`
 * stores its data in a `props` field that is `protected` only at compile time; at runtime it is an
 * ordinary own enumerable property, so returning one verbatim would serialize as
 * `{"props": {"id": {"props": {"value": "..."}}, ...}}` — the same nested-`props` leak documented
 * at the top of `public-catalog-routes.ts`, just on value objects instead of entities. These DTOs
 * are the boundary that was missing; every field below is read through the value objects' own
 * getters, never off `props` directly.
 */
export interface AnalyticsMeasureDto {
  readonly id: string;
  readonly aggregation: Aggregation;
  readonly readModelId: string;
  readonly physicalField: string;
}

export interface AnalyticsMetricDto {
  readonly id: string;
  readonly kind: "definition" | "calculated";
  readonly unit: MetricUnit;
  readonly description: string;
  readonly measure?: AnalyticsMeasureDto;
  readonly expression?: MetricExpression;
}

export interface AnalyticsDimensionDto {
  readonly id: string;
  readonly label: string;
  readonly readModelId: string;
  readonly physicalField: string;
}

function toMetricDto(metric: Metric): AnalyticsMetricDto {
  if (metric instanceof MetricDefinition) {
    return {
      id: metric.id.value,
      kind: "definition",
      unit: metric.unit,
      description: metric.description,
      measure: {
        id: metric.measure.id.value,
        aggregation: metric.measure.aggregation,
        readModelId: metric.measure.binding.readModelId.value,
        physicalField: metric.measure.binding.physicalField,
      },
    };
  }
  return {
    id: metric.id.value,
    kind: "calculated",
    unit: metric.unit,
    description: metric.description,
    expression: metric.expression,
  };
}

function toDimensionDto(dimension: DimensionDefinition): AnalyticsDimensionDto {
  return {
    id: dimension.id.value,
    label: dimension.label,
    readModelId: dimension.binding.readModelId.value,
    physicalField: dimension.binding.physicalField,
  };
}

/** Maps a controller response's `Metric`/`DimensionDefinition` body(ies) through its DTO, leaving any non-2xx error envelope untouched. */
function mapAnalytics<TDomain, TDto>(
  response: { readonly status: number; readonly body: unknown },
  toDto: (domain: TDomain) => TDto,
): { readonly status: number; readonly body: unknown } {
  if (response.status < 200 || response.status >= 300) return response;
  const body = response.body;
  const mapped = Array.isArray(body) ? (body as TDomain[]).map(toDto) : toDto(body as TDomain);
  return { status: response.status, body: mapped };
}

/** The Analytics admin HTTP surface (Sprint S1) — the semantic-layer catalog, read-only. */
export function analyticsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/analytics/metrics",
      version: 1,
      permission: "analytics:read",
      summary: "List every governed metric definition",
      schema: {},
      handle: async ({ context }) =>
        mapAnalytics<Metric, AnalyticsMetricDto>(
          await admin.analytics.listMetrics(context.principal),
          toMetricDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/analytics/metrics/:id",
      version: 1,
      permission: "analytics:read",
      summary: "Get a single metric definition",
      schema: { params: metricIdParams },
      handle: async ({ params, context }) =>
        mapAnalytics<Metric, AnalyticsMetricDto>(
          await admin.analytics.getMetric(context.principal, params),
          toMetricDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/analytics/dimensions",
      version: 1,
      permission: "analytics:read",
      summary: "List every governed dimension definition",
      schema: {},
      handle: async ({ context }) =>
        mapAnalytics<DimensionDefinition, AnalyticsDimensionDto>(
          await admin.analytics.listDimensions(context.principal),
          toDimensionDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/analytics/dimensions/:id",
      version: 1,
      permission: "analytics:read",
      summary: "Get a single dimension definition",
      schema: { params: dimensionIdParams },
      handle: async ({ params, context }) =>
        mapAnalytics<DimensionDefinition, AnalyticsDimensionDto>(
          await admin.analytics.getDimension(context.principal, params),
          toDimensionDto,
        ),
    }),
  ] as readonly RouteDefinition[];
}
