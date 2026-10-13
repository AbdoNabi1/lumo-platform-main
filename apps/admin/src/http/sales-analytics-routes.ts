import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import {
  isSalesRangePreset,
  localDay,
  previousPresetRange,
  previousSalesRange,
  resolveSalesRange,
  SALES_RANGE_PRESETS,
  validateSalesRange,
  type DailySales,
  type SalesSummary,
  type SalesTopProduct,
} from "@platform/orders";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import { fulfillmentStatusesOf } from "./fulfillment-statuses-of";
import { lineKey, resolveLineImages, type ImageDto } from "./product-images";

/** Orders are looked up in Fulfillment this many at a time (one batched read per chunk). */
const FULFILLMENT_BATCH = 500;

/**
 * Either a preset (`range`, resolved here against today in the shop's own zone) or an explicit
 * `[from, to)` of dates in that zone. Every field is optional so that a missing or malformed one is a
 * 400 from the handler (the platform answers a schema failure with 422).
 */
const salesQuery = z.object({
  range: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

function invalidRange(message: string): AdminResponse {
  return { status: 400, body: { error: { code: "INVALID_RANGE", message } } };
}

export interface SalesTopProductDto extends SalesTopProduct {
  /** The variant's picture, else the product's featured one; `null` shows the placeholder. */
  readonly imageUrl: string | null;
}

/** One range of the report. `ordersToFulfill` and `topProducts` are only worked out for the current one. */
export interface SalesAnalyticsRangeDto {
  readonly totalSalesMinor: number;
  readonly ordersCount: number;
  readonly averageOrderValueMinor: number;
  readonly daily: readonly DailySales[];
  readonly otherCurrencyOrders: number;
}

export interface SalesAnalyticsDto {
  readonly current: SalesAnalyticsRangeDto & {
    /** All-time, not range-bound: orders still waiting to be fulfilled. */
    readonly ordersToFulfill: number;
    readonly topProducts: readonly SalesTopProductDto[];
  };
  readonly previous: SalesAnalyticsRangeDto;
  readonly currency: string;
  readonly timezone: string;
  readonly range: { readonly from: string; readonly to: string };
  readonly previousRange: { readonly from: string; readonly to: string };
}

function rangeOf(summary: SalesSummary): SalesAnalyticsRangeDto {
  return {
    totalSalesMinor: summary.totalSalesMinor,
    ordersCount: summary.ordersCount,
    averageOrderValueMinor: summary.averageOrderValueMinor,
    daily: summary.daily,
    otherCurrencyOrders: summary.otherCurrencyOrders,
  };
}

/**
 * How many of the shop's open orders still have to be fulfilled. Whether one does is Fulfillment's
 * fact, derived with the Plan 3B function in `fulfillmentStatusesOf` (the same one the orders list
 * uses), so the Home card and the list's "Unfulfilled" never disagree. A read that fails is answered
 * as the failure: a count of 0 would be a made-up number.
 */
async function countOrdersToFulfill(
  admin: WiredAdmin,
  principal: Parameters<typeof fulfillmentStatusesOf>[1],
  tenantId: string,
  openOrderIds: readonly string[],
): Promise<{ readonly count: number } | { readonly response: AdminResponse }> {
  let count = 0;
  for (let start = 0; start < openOrderIds.length; start += FULFILLMENT_BATCH) {
    const chunk = openOrderIds.slice(start, start + FULFILLMENT_BATCH);
    const statuses = await fulfillmentStatusesOf(admin, principal, tenantId, chunk);
    if (!statuses.ok) return { response: statuses.response };
    count += chunk.filter(
      (id) => (statuses.byOrder.get(id) ?? "unfulfilled") === "unfulfilled",
    ).length;
  }
  return { count };
}

/** Plan 3D — the Home dashboard's and the Analytics page's numbers, computed from the shop's orders. */
export function salesAnalyticsRoutes(
  admin: WiredAdmin,
  options: { readonly now?: () => Date } = {},
): readonly RouteDefinition[] {
  const now = options.now ?? (() => new Date());
  return [
    defineRoute({
      method: "GET",
      path: "/analytics/sales",
      version: 1,
      permission: "orders:read",
      summary:
        "Sales, orders, average order value, orders to fulfill, a daily series and top products for [from, to), with the range before it",
      schema: { querystring: salesQuery },
      handle: async ({ query, context }): Promise<AdminResponse> => {
        const preset = query.range;
        if (preset !== undefined && !isSalesRangePreset(preset)) {
          return invalidRange(`"range" must be one of ${SALES_RANGE_PRESETS.join(", ")}`);
        }
        if (preset === undefined) {
          const problem = validateSalesRange(query.from ?? "", query.to ?? "");
          if (problem !== null) return invalidRange(problem);
        }

        const region = await admin.tenancy.getStoreRegion(context.principal);
        if (region.status !== 200) return region;
        const { timezone, currency } = region.body as { timezone: string; currency: string };

        // A preset means today in the SHOP's zone, not the server's or the browser's.
        const today = localDay(now(), timezone);
        const { from, to } =
          preset !== undefined
            ? resolveSalesRange(preset, today)
            : { from: query.from ?? "", to: query.to ?? "" };
        // "This month" is compared with the same days of last month, as Shopify does.
        const previous =
          preset !== undefined ? previousPresetRange(preset, today) : previousSalesRange(from, to);

        const response = await admin.orders.salesReport(context.principal, {
          tenantId: context.tenantId,
          from,
          to,
          previous,
          timezone,
          currency,
        });
        if (response.status !== 200) return response;
        const report = response.body as {
          readonly current: SalesSummary;
          readonly previous: SalesSummary;
          readonly currency: string;
          readonly timezone: string;
        };

        const toFulfill = await countOrdersToFulfill(
          admin,
          context.principal,
          context.tenantId,
          report.current.openOrderIds,
        );
        if ("response" in toFulfill) return toFulfill.response;

        const images: ReadonlyMap<string, ImageDto | null> =
          report.current.topProducts.length === 0
            ? new Map()
            : await resolveLineImages(
                admin,
                context.tenantId,
                report.current.topProducts.map((product) => ({
                  productId: product.productRef,
                  variantId: product.variantRef,
                })),
              );

        const body: SalesAnalyticsDto = {
          current: {
            ...rangeOf(report.current),
            ordersToFulfill: toFulfill.count,
            topProducts: report.current.topProducts.map((product) => ({
              ...product,
              imageUrl: images.get(lineKey(product.productRef, product.variantRef))?.url ?? null,
            })),
          },
          previous: rangeOf(report.previous),
          currency: report.currency,
          timezone: report.timezone,
          range: { from, to },
          previousRange: previous,
        };
        return { status: 200, body };
      },
    }),
  ] as readonly RouteDefinition[];
}
