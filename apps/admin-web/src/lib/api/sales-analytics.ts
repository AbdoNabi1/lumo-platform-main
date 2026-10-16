import type { DashboardRange } from "@/lib/dashboard/ranges";
import { getAdminApi } from "./client";

/**
 * Plan 3D: the numbers on Home and the Analytics page, as `GET /analytics/sales` answers them: real
 * figures computed from the shop's orders, in the shop's own currency and time zone. Money is in minor
 * units; every day of the range is listed, zero days included.
 */

export interface DailySalesDto {
  /** The day in the SHOP's calendar, `YYYY-MM-DD`. */
  readonly date: string;
  readonly salesMinor: number;
  readonly orders: number;
}

export interface SalesTopProductDto {
  readonly productRef: string;
  readonly variantRef: string | null;
  readonly name: string;
  readonly variantTitle: string | null;
  readonly quantity: number;
  readonly salesMinor: number;
  /** The variant's picture, else the product's featured one; null shows the placeholder. */
  readonly imageUrl: string | null;
}

export interface SalesRangeDto {
  readonly totalSalesMinor: number;
  readonly ordersCount: number;
  readonly averageOrderValueMinor: number;
  readonly daily: readonly DailySalesDto[];
  /** Orders in the range in some other currency: not in any sum, and the page says so. */
  readonly otherCurrencyOrders: number;
}

export interface SalesAnalyticsDto {
  readonly current: SalesRangeDto & {
    /** All-time (not range-bound): open orders still waiting to be fulfilled. */
    readonly ordersToFulfill: number;
    readonly topProducts: readonly SalesTopProductDto[];
  };
  readonly previous: SalesRangeDto;
  readonly currency: string;
  readonly timezone: string;
  /** The days `current` covers: `to` is exclusive. */
  readonly range: { readonly from: string; readonly to: string };
  readonly previousRange: { readonly from: string; readonly to: string };
}

export type FetchSalesAnalyticsResult =
  | { readonly outcome: "ok"; readonly data: SalesAnalyticsDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isDay(value: unknown): value is DailySalesDto {
  return (
    isObject(value) &&
    isString(value["date"]) &&
    isCount(value["salesMinor"]) &&
    isCount(value["orders"])
  );
}

function isTopProduct(value: unknown): value is SalesTopProductDto {
  return (
    isObject(value) &&
    isString(value["productRef"]) &&
    isNullableString(value["variantRef"]) &&
    isString(value["name"]) &&
    isNullableString(value["variantTitle"]) &&
    isCount(value["quantity"]) &&
    isCount(value["salesMinor"]) &&
    isNullableString(value["imageUrl"])
  );
}

function isRange(value: unknown): value is SalesRangeDto {
  return (
    isObject(value) &&
    isCount(value["totalSalesMinor"]) &&
    isCount(value["ordersCount"]) &&
    isCount(value["averageOrderValueMinor"]) &&
    Array.isArray(value["daily"]) &&
    value["daily"].every(isDay) &&
    isCount(value["otherCurrencyOrders"])
  );
}

function isDayRange(value: unknown): value is { from: string; to: string } {
  return isObject(value) && isString(value["from"]) && isString(value["to"]);
}

function isSalesAnalytics(value: unknown): value is SalesAnalyticsDto {
  if (!isObject(value)) return false;
  const current = value["current"];
  return (
    isRange(current) &&
    isCount((current as unknown as Record<string, unknown>)["ordersToFulfill"]) &&
    Array.isArray((current as unknown as Record<string, unknown>)["topProducts"]) &&
    ((current as unknown as Record<string, unknown>)["topProducts"] as unknown[]).every(
      isTopProduct,
    ) &&
    isRange(value["previous"]) &&
    isString(value["currency"]) &&
    isString(value["timezone"]) &&
    isDayRange(value["range"]) &&
    isDayRange(value["previousRange"])
  );
}

/**
 * Fetches Home's figures for a named range (`GET /analytics/sales?range=`). The API resolves the
 * range against today in the shop's own time zone, so neither the browser's clock nor the server's
 * decides which day is today. Never throws, and never answers with made-up numbers: an API that
 * cannot be reached, a refusal or an unexpected shape is a typed outcome the page shows as an error
 * with "Try again".
 */
export async function fetchSalesAnalytics(
  range: DashboardRange,
): Promise<FetchSalesAnalyticsResult> {
  const result = await getAdminApi(
    `/api/v1/analytics/sales?range=${encodeURIComponent(range)}`,
    isSalesAnalytics,
  );
  if (result.outcome === "ok") return { outcome: "ok", data: result.data };
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}
