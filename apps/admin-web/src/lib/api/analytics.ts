import { getAdminApi } from "./client";

export interface AnalyticsMeasureDto {
  readonly id: string;
  readonly aggregation: string;
  readonly readModelId: string;
  readonly physicalField: string;
}

export interface AnalyticsMetricDto {
  readonly id: string;
  readonly kind: "definition" | "calculated";
  readonly unit: string;
  readonly description: string;
  readonly measure?: AnalyticsMeasureDto;
}

export interface AnalyticsDimensionDto {
  readonly id: string;
  readonly label: string;
  readonly readModelId: string;
  readonly physicalField: string;
}

function isAnalyticsMetricDto(value: unknown): value is AnalyticsMetricDto {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["id"] === "string" &&
    (candidate["kind"] === "definition" || candidate["kind"] === "calculated") &&
    typeof candidate["unit"] === "string" &&
    typeof candidate["description"] === "string"
  );
}

function isAnalyticsDimensionDto(value: unknown): value is AnalyticsDimensionDto {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["id"] === "string" &&
    typeof candidate["label"] === "string" &&
    typeof candidate["readModelId"] === "string" &&
    typeof candidate["physicalField"] === "string"
  );
}

function isAnalyticsMetricList(value: unknown): value is readonly AnalyticsMetricDto[] {
  return Array.isArray(value) && value.every(isAnalyticsMetricDto);
}

function isAnalyticsDimensionList(value: unknown): value is readonly AnalyticsDimensionDto[] {
  return Array.isArray(value) && value.every(isAnalyticsDimensionDto);
}

export type FetchAnalyticsMetricsResult =
  | { readonly outcome: "ok"; readonly items: readonly AnalyticsMetricDto[] }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

export type FetchAnalyticsDimensionsResult =
  | { readonly outcome: "ok"; readonly items: readonly AnalyticsDimensionDto[] }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches every governed metric definition (`GET /analytics/metrics`) — no pagination, no querystring. */
export async function fetchAnalyticsMetrics(): Promise<FetchAnalyticsMetricsResult> {
  const result = await getAdminApi("/api/v1/analytics/metrics", isAnalyticsMetricList);
  if (result.outcome === "ok") {
    return { outcome: "ok", items: result.data };
  }
  if (result.outcome === "unauthorized") {
    return { outcome: "unauthorized" };
  }
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}

/** Fetches every governed dimension definition (`GET /analytics/dimensions`) — no pagination, no querystring. */
export async function fetchAnalyticsDimensions(): Promise<FetchAnalyticsDimensionsResult> {
  const result = await getAdminApi("/api/v1/analytics/dimensions", isAnalyticsDimensionList);
  if (result.outcome === "ok") {
    return { outcome: "ok", items: result.data };
  }
  if (result.outcome === "unauthorized") {
    return { outcome: "unauthorized" };
  }
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}
