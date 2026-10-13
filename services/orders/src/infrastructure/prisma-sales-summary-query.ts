import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import {
  assembleSalesSummary,
  TOP_PRODUCTS_LIMIT,
  type MeasuredDay,
  type SalesSummary,
  type SalesSummaryInput,
  type SalesSummaryQuery,
  type TopProduct,
} from "../application/sales-summary";
import { CANCELLED_EVENT_TYPE, REFUNDED_EVENT_TYPES } from "../domain/order-statuses";

export interface PrismaSalesSummaryQueryDeps {
  readonly prisma: Database;
}

interface DailyRow {
  readonly day: string;
  readonly orders: bigint | number;
  readonly sales_minor: bigint | number;
}

interface TopProductRow {
  readonly product_ref: string;
  readonly variant_ref: string | null;
  readonly name: string;
  readonly variant_title: string | null;
  readonly quantity: bigint | number;
  readonly sales_minor: bigint | number;
}

interface CountRow {
  readonly count: bigint | number;
}

interface IdRow {
  readonly id: string;
}

const CANCELLED: readonly string[] = [CANCELLED_EVENT_TYPE];
const REFUNDED: readonly string[] = REFUNDED_EVENT_TYPES;
// `closed` is terminal in the lifecycle (nothing follows it), so "has a closed event" is "is closed".
const CANCELLED_OR_CLOSED: readonly string[] = [CANCELLED_EVENT_TYPE, "closed"];

/**
 * Production {@link SalesSummaryQuery}: the dashboard's figures as SQL aggregates over
 * `orders.orders`, `orders.order_items` and `orders.order_events`, never a page-by-page walk of
 * hydrated aggregates. An order's status is not a column (the events are the record), so "cancelled"
 * and "refunded" are `EXISTS` over the events, exactly as `derivePaymentStatus` reads them (the event
 * type lists are the same constants).
 *
 * A raw query has no Prisma `where` for the tenant guard to read, so EVERY reference to a table below
 * carries its own `tenant_id = <bound tenant>`. Money columns are `int`/`bigint` in minor units; sums
 * are cast to `bigint` and returned as `BigInt`, which {@link toNumber} narrows (a shop's sales fit a
 * double many times over).
 *
 * `created_at` is `timestamp without time zone` holding UTC. A shop's calendar day is therefore
 * `(created_at AT TIME ZONE 'UTC') AT TIME ZONE <zone>` (UTC read as an instant, then shown in the
 * shop's zone), and the range bounds are the shop-local midnights of `from` and `to` converted back
 * to UTC the same way in reverse.
 */
export class PrismaSalesSummaryQuery implements SalesSummaryQuery {
  private readonly deps: PrismaSalesSummaryQueryDeps;

  constructor(deps: PrismaSalesSummaryQueryDeps) {
    this.deps = deps;
  }

  async summarize(input: SalesSummaryInput): Promise<SalesSummary> {
    return runReadScoped(this.deps.prisma, input.tenantId, async (client) => {
      const measuredDays = await this.measureDays(client, input);
      const topProducts = await this.measureTopProducts(client, input);
      const otherCurrencyOrders = await this.countOtherCurrency(client, input);
      const openOrderIds =
        input.includeOpenOrderIds === true ? await this.openOrderIds(client, input.tenantId) : [];
      return assembleSalesSummary({
        from: input.from,
        to: input.to,
        measuredDays,
        topProducts,
        otherCurrencyOrders,
        openOrderIds,
      });
    });
  }

  /** Counted orders (in range, in the shop's currency, never cancelled) per shop-local day. */
  private async measureDays(
    client: TransactionClient,
    input: SalesSummaryInput,
  ): Promise<readonly MeasuredDay[]> {
    const { tenantId, timezone, currency, from, to } = input;
    const rows = await client.$queryRaw<DailyRow[]>`
      SELECT "counted"."day" AS "day",
             COUNT(*)::bigint AS "orders",
             COALESCE(SUM(CASE WHEN "counted"."refunded" THEN 0 ELSE "counted"."total_minor" END), 0)::bigint AS "sales_minor"
      FROM (
        SELECT to_char(((o."created_at" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}), 'YYYY-MM-DD') AS "day",
               EXISTS (
                 SELECT 1 FROM "orders"."order_events" r
                 WHERE r."order_id" = o."id" AND r."tenant_id" = ${tenantId} AND r."type" = ANY(${REFUNDED})
               ) AS "refunded",
               COALESCE(
                 (o."totals"->>'totalMinor')::bigint,
                 (SELECT COALESCE(SUM(i."unit_price_amount_minor"::bigint * i."quantity"), 0)
                  FROM "orders"."order_items" i
                  WHERE i."order_id" = o."id" AND i."tenant_id" = ${tenantId})
               ) AS "total_minor"
        FROM "orders"."orders" o
        WHERE o."tenant_id" = ${tenantId}
          AND o."currency" = ${currency}
          AND o."created_at" >= ((${from}::date)::timestamp AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC'
          AND o."created_at" < ((${to}::date)::timestamp AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC'
          AND NOT EXISTS (
            SELECT 1 FROM "orders"."order_events" c
            WHERE c."order_id" = o."id" AND c."tenant_id" = ${tenantId} AND c."type" = ANY(${CANCELLED})
          )
      ) "counted"
      GROUP BY "counted"."day"
      ORDER BY "counted"."day"`;
    return rows.map((row) => ({
      date: row.day,
      orders: toNumber(row.orders),
      salesMinor: toNumber(row.sales_minor),
    }));
  }

  /** Units and sales per product variant over counted, non-refunded orders; ranked by the SQL and again by the shared ranking. */
  private async measureTopProducts(
    client: TransactionClient,
    input: SalesSummaryInput,
  ): Promise<readonly TopProduct[]> {
    const { tenantId, timezone, currency, from, to } = input;
    const rows = await client.$queryRaw<TopProductRow[]>`
      SELECT i."product_ref" AS "product_ref",
             i."variant_ref" AS "variant_ref",
             MAX(i."name") AS "name",
             MAX(i."variant_title") AS "variant_title",
             SUM(i."quantity")::bigint AS "quantity",
             SUM(i."unit_price_amount_minor"::bigint * i."quantity")::bigint AS "sales_minor"
      FROM "orders"."order_items" i
      JOIN "orders"."orders" o ON o."id" = i."order_id" AND o."tenant_id" = ${tenantId}
      WHERE i."tenant_id" = ${tenantId}
        AND o."currency" = ${currency}
        AND o."created_at" >= ((${from}::date)::timestamp AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC'
        AND o."created_at" < ((${to}::date)::timestamp AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC'
        AND NOT EXISTS (
          SELECT 1 FROM "orders"."order_events" c
          WHERE c."order_id" = o."id" AND c."tenant_id" = ${tenantId} AND c."type" = ANY(${CANCELLED})
        )
        AND NOT EXISTS (
          SELECT 1 FROM "orders"."order_events" r
          WHERE r."order_id" = o."id" AND r."tenant_id" = ${tenantId} AND r."type" = ANY(${REFUNDED})
        )
      GROUP BY i."product_ref", i."variant_ref"
      ORDER BY "quantity" DESC, "sales_minor" DESC, "name" ASC, i."product_ref" ASC, i."variant_ref" ASC NULLS FIRST
      LIMIT ${TOP_PRODUCTS_LIMIT}`;
    return rows.map((row) => ({
      productRef: row.product_ref,
      variantRef: row.variant_ref,
      name: row.name,
      variantTitle: row.variant_title,
      quantity: toNumber(row.quantity),
      salesMinor: toNumber(row.sales_minor),
    }));
  }

  /** Orders in the range in some other currency, never cancelled: shown to the merchant, not summed. */
  private async countOtherCurrency(
    client: TransactionClient,
    input: SalesSummaryInput,
  ): Promise<number> {
    const { tenantId, timezone, currency, from, to } = input;
    const rows = await client.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS "count"
      FROM "orders"."orders" o
      WHERE o."tenant_id" = ${tenantId}
        AND o."currency" <> ${currency}
        AND o."created_at" >= ((${from}::date)::timestamp AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC'
        AND o."created_at" < ((${to}::date)::timestamp AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC'
        AND NOT EXISTS (
          SELECT 1 FROM "orders"."order_events" c
          WHERE c."order_id" = o."id" AND c."tenant_id" = ${tenantId} AND c."type" = ANY(${CANCELLED})
        )`;
    return toNumber(rows[0]?.count ?? 0);
  }

  /** Every order that is neither cancelled nor closed, all-time: the candidates for "orders to fulfill". */
  private async openOrderIds(
    client: TransactionClient,
    tenantId: string,
  ): Promise<readonly string[]> {
    const rows = await client.$queryRaw<IdRow[]>`
      SELECT o."id"::text AS "id"
      FROM "orders"."orders" o
      WHERE o."tenant_id" = ${tenantId}
        AND NOT EXISTS (
          SELECT 1 FROM "orders"."order_events" e
          WHERE e."order_id" = o."id" AND e."tenant_id" = ${tenantId} AND e."type" = ANY(${CANCELLED_OR_CLOSED})
        )
      ORDER BY o."id" DESC`;
    return rows.map((row) => row.id);
  }
}

function toNumber(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}
