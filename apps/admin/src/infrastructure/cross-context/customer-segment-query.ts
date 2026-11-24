import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import { tagKeyOf, type SegmentCondition } from "@platform/identity";
import { CANCELLED_EVENT_TYPE, REFUNDED_EVENT_TYPES } from "@platform/orders";
import { AppError } from "@platform/utils";

/**
 * Wave 1c — the LIVE membership of a customer segment: one tenant-scoped SQL statement over
 * `identity.customers` and a per-customer aggregate of `orders.orders`, compiled from the fixed
 * filter vocabulary (`SegmentCondition`). Nothing is stored; every read is current.
 *
 * Rules shared with the rest of the platform (and pinned by tests):
 *  - orders count / amount spent / last order: orders in the SHOP currency that never got a
 *    `cancelled` event; a refunded order counts as an order but spends 0; the total is
 *    `totals->>'totalMinor'` else the item sum with the bigint cast BEFORE the multiplication —
 *    exactly `services/orders/src/infrastructure/prisma-sales-summary-query.ts`;
 *  - subscription = the latest `identity.consent_records` row of the scope (`occurred_at DESC,
 *    id DESC`); no record = not subscribed;
 *  - day windows are rolling durations in UTC (`now` bound as `timestamp` holding UTC), calendar
 *    dates are the shop zone's midnights, like the sales summary.
 */

export interface SegmentMemberRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly isGuest: boolean;
  readonly ordersCount: number;
  readonly amountSpentMinor: number;
  readonly lastOrderAt: string | null;
  readonly emailSubscribed: boolean;
  readonly smsSubscribed: boolean;
}

export interface SegmentMembersInput {
  readonly tenantId: string;
  readonly conditions: readonly SegmentCondition[];
  readonly currency: string;
  readonly timezone: string;
  readonly now: Date;
  readonly first: number;
  readonly after?: string;
  readonly search?: string;
}

export interface SegmentMembersPage {
  readonly items: readonly SegmentMemberRow[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
  readonly total: number;
  /** The shop currency every amount on the page is in. */
  readonly currency: string;
}

export interface CustomerSegmentQuery {
  members(input: SegmentMembersInput): Promise<SegmentMembersPage>;
}

export interface CompiledStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export interface CompiledSegmentQuery {
  readonly list: CompiledStatement;
  readonly count: CompiledStatement;
}

export const SEGMENT_MEMBERS_MAX_PAGE = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

const COMPARATORS = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
} as const;

function assertNever(value: never): never {
  throw new Error(`Unhandled segment condition: ${JSON.stringify(value)}`);
}

function integerParam(value: number, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`Segment condition ${label} must be an integer in ${min}..${max}`);
  }
  return value;
}

/** `%`, `_` and the escape character itself are literal characters in a user's search. */
export function escapeLikePattern(raw: string): string {
  return raw.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** The distinct tag keys of a tag condition, normalized exactly like `customer_tags.tag_key`. */
function distinctTagKeys(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => tagKeyOf(value)).filter((key) => key !== ""))];
}

/** The distinct, trimmed, upper-cased country codes of a country condition. */
function distinctCountries(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toUpperCase()).filter((v) => v !== ""))];
}

/** Latest consent per scope: `occurred_at DESC, id DESC` (a tie is won by the higher id). */
function latestConsent(alias: "cre" | "crs", scope: "marketing" | "marketing_sms"): string {
  return (
    `COALESCE((SELECT ${alias}."granted" FROM "identity"."consent_records" ${alias} ` +
    `WHERE ${alias}."customer_id" = c."id" AND ${alias}."tenant_id" = $1 ` +
    `AND ${alias}."scope" = '${scope}' ` +
    `ORDER BY ${alias}."occurred_at" DESC, ${alias}."id" DESC LIMIT 1), FALSE)`
  );
}

const EMAIL_SUBSCRIBED = latestConsent("cre", "marketing");
const SMS_SUBSCRIBED = latestConsent("crs", "marketing_sms");

/**
 * Builds the two statements of one page: the list (with cursor and limit) and the total (same
 * filters, nothing else). Each statement carries its OWN bind array: the shared filter fragments
 * are compiled once into a base array, `count.params` is that array and `list.params` is a copy
 * plus the cursor and `first + 1`. Pure: SQL text comes only from fixed fragments chosen by closed
 * switches; every value is a positional parameter.
 *
 * A non-UUID `after` can never match a customer id, so the list gets a `FALSE` predicate (an empty
 * page) while the total still counts the filtered set.
 */
export function compileSegmentQuery(input: SegmentMembersInput): CompiledSegmentQuery {
  const first = integerParam(input.first, "page size", 1, SEGMENT_MEMBERS_MAX_PAGE);
  const params: unknown[] = [
    input.tenantId,
    input.currency,
    [CANCELLED_EVENT_TYPE],
    [...REFUNDED_EVENT_TYPES],
  ];
  const bind = (value: unknown, cast: string): string => {
    params.push(value);
    return `$${params.length}::${cast}`;
  };
  let nowRef: string | undefined;
  const now = (): string => (nowRef ??= bind(input.now.toISOString(), "timestamp"));
  let zoneRef: string | undefined;
  const zone = (): string => (zoneRef ??= bind(input.timezone, "text"));

  /** A rolling UTC duration back from `now` (never the session time zone). */
  const rolling = (days: number): string =>
    `(${now()} - make_interval(days => ${bind(integerParam(days, "days", 1, 3650), "int")}))`;
  /** The UTC instant of the shop-zone midnight that starts `date` (as the sales summary). */
  const calendar = (date: string): string => {
    if (!CALENDAR_DATE.test(date))
      throw new RangeError("Segment condition date must be YYYY-MM-DD");
    return `((${bind(date, "date")})::timestamp AT TIME ZONE ${zone()}) AT TIME ZONE 'UTC'`;
  };

  function predicateOf(condition: SegmentCondition): string {
    switch (condition.field) {
      case "orders_count":
        return `COALESCE(oa."orders_count", 0) ${COMPARATORS[condition.op]} ${bind(
          integerParam(condition.value, "orders_count", 0, 1_000_000),
          "int",
        )}`;
      case "amount_spent":
        return `COALESCE(oa."spent_minor", 0) ${COMPARATORS[condition.op]} ${bind(
          integerParam(condition.valueMinor, "amount_spent", 0, 10 ** 12),
          "bigint",
        )}`;
      case "last_order_date":
        switch (condition.op) {
          case "within_last_days":
            return `(oa."last_order_at" IS NOT NULL AND oa."last_order_at" >= ${rolling(condition.days)})`;
          case "not_within_last_days":
            return `(oa."last_order_at" IS NULL OR oa."last_order_at" < ${rolling(condition.days)})`;
          case "on_or_after":
            return `(oa."last_order_at" IS NOT NULL AND oa."last_order_at" >= ${calendar(condition.date)})`;
          case "before":
            return `(oa."last_order_at" IS NOT NULL AND oa."last_order_at" < ${calendar(condition.date)})`;
          case "never":
            return `oa."last_order_at" IS NULL`;
          default:
            return assertNever(condition);
        }
      case "created_date":
        switch (condition.op) {
          case "within_last_days":
            return `c."created_at" >= ${rolling(condition.days)}`;
          case "not_within_last_days":
            return `c."created_at" < ${rolling(condition.days)}`;
          case "on_or_after":
            return `c."created_at" >= ${calendar(condition.date)}`;
          case "before":
            return `c."created_at" < ${calendar(condition.date)}`;
          default:
            return assertNever(condition);
        }
      case "email_subscribed":
        return `${EMAIL_SUBSCRIBED} = ${bind(condition.value === true, "boolean")}`;
      case "sms_subscribed":
        return `${SMS_SUBSCRIBED} = ${bind(condition.value === true, "boolean")}`;
      case "tags": {
        const keys = bind(distinctTagKeys(condition.values), "text[]");
        const matching =
          `FROM "identity"."customer_tags" t WHERE t."customer_id" = c."id" ` +
          `AND t."tenant_id" = $1 AND t."tag_key" = ANY(${keys})`;
        switch (condition.op) {
          case "has_any":
            return `EXISTS (SELECT 1 ${matching})`;
          case "has_none":
            return `NOT EXISTS (SELECT 1 ${matching})`;
          case "has_all":
            return `(SELECT count(DISTINCT t."tag_key") ${matching}) = cardinality(${keys})`;
          default:
            return assertNever(condition);
        }
      }
      case "country": {
        const codes = bind(distinctCountries(condition.values), "text[]");
        const matching =
          `FROM "identity"."addresses" a WHERE a."customer_id" = c."id" ` +
          `AND a."tenant_id" = $1 AND upper(trim(a."country")) = ANY(${codes})`;
        switch (condition.op) {
          case "in":
            return `EXISTS (SELECT 1 ${matching})`;
          case "not_in":
            return `NOT EXISTS (SELECT 1 ${matching})`;
          default:
            return assertNever(condition);
        }
      }
      case "language":
        switch (condition.op) {
          case "eq":
            return `c."language" = ${bind(condition.value, "text")}`;
          case "neq":
            return `c."language" IS DISTINCT FROM ${bind(condition.value, "text")}`;
          case "unset":
            return `c."language" IS NULL`;
          default:
            return assertNever(condition);
        }
      default:
        return assertNever(condition);
    }
  }

  const predicates: string[] = input.conditions.map((condition) => predicateOf(condition));
  const search = input.search?.trim() ?? "";
  if (search !== "") {
    const pattern = bind(`%${escapeLikePattern(search)}%`, "text");
    predicates.push(`(c."name" ILIKE ${pattern} OR c."email" ILIKE ${pattern})`);
  }

  const orderAggregate =
    `WITH "oa" AS (SELECT o."customer_ref" AS "customer_ref", ` +
    `count(*)::int AS "orders_count", ` +
    `COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM "orders"."order_events" xr ` +
    `WHERE xr."order_id" = o."id" AND xr."tenant_id" = $1 AND xr."type" = ANY($4::text[])) ` +
    `THEN 0 ELSE COALESCE((o."totals"->>'totalMinor')::bigint, ` +
    `(SELECT COALESCE(SUM(i."unit_price_amount_minor"::bigint * i."quantity"), 0) ` +
    `FROM "orders"."order_items" i WHERE i."order_id" = o."id" AND i."tenant_id" = $1)) END), 0)::bigint AS "spent_minor", ` +
    `max(o."created_at") AS "last_order_at" ` +
    `FROM "orders"."orders" o WHERE o."tenant_id" = $1 AND o."currency" = $2::text ` +
    `AND NOT EXISTS (SELECT 1 FROM "orders"."order_events" xc ` +
    `WHERE xc."order_id" = o."id" AND xc."tenant_id" = $1 AND xc."type" = ANY($3::text[])) ` +
    `GROUP BY o."customer_ref")`;
  const from = `FROM "identity"."customers" c LEFT JOIN "oa" oa ON oa."customer_ref" = c."id"::text`;
  const where = [`c."tenant_id" = $1`, `c."deleted_at" IS NULL`, ...predicates].join(" AND ");

  const count: CompiledStatement = {
    sql: `${orderAggregate} SELECT count(*)::bigint AS "total" ${from} WHERE ${where}`,
    params: [...params],
  };

  const listParams: unknown[] = [...params];
  const listBind = (value: unknown, cast: string): string => {
    listParams.push(value);
    return `$${listParams.length}::${cast}`;
  };
  const after = input.after;
  const cursor =
    after === undefined
      ? ""
      : UUID.test(after)
        ? ` AND c."id" < ${listBind(after, "uuid")}`
        : " AND FALSE";
  const limit = listBind(first + 1, "int");
  const list: CompiledStatement = {
    sql:
      `${orderAggregate} SELECT c."id"::text AS "id", c."name" AS "name", c."email" AS "email", ` +
      `c."is_guest" AS "is_guest", COALESCE(oa."orders_count", 0)::int AS "orders_count", ` +
      `COALESCE(oa."spent_minor", 0)::bigint AS "spent_minor", oa."last_order_at" AS "last_order_at", ` +
      `${EMAIL_SUBSCRIBED} AS "email_subscribed", ${SMS_SUBSCRIBED} AS "sms_subscribed" ` +
      `${from} WHERE ${where}${cursor} ORDER BY c."id" DESC LIMIT ${limit}`,
    params: listParams,
  };
  return { list, count };
}

interface MemberSqlRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly is_guest: boolean;
  readonly orders_count: bigint | number;
  readonly spent_minor: bigint | number;
  readonly last_order_at: Date | string | null;
  readonly email_subscribed: boolean;
  readonly sms_subscribed: boolean;
}

interface TotalSqlRow {
  readonly total: bigint | number;
}

function toNumber(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}

/** `timestamp without time zone` holds UTC: a string without a zone designator is read as UTC. */
function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const hasZone = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value);
  return new Date(hasZone ? value : `${value.replace(" ", "T")}Z`).toISOString();
}

export interface PrismaCustomerSegmentQueryDeps {
  readonly prisma: Database;
}

/**
 * Production {@link CustomerSegmentQuery}: runs the compiled list and count inside
 * `runReadScoped` (so `app.tenant_id` is set and RLS is the second wall), each statement with its
 * own bind array, in one transaction so `total` and the page see the same snapshot.
 */
export class PrismaCustomerSegmentQuery implements CustomerSegmentQuery {
  private readonly deps: PrismaCustomerSegmentQueryDeps;

  constructor(deps: PrismaCustomerSegmentQueryDeps) {
    this.deps = deps;
  }

  async members(input: SegmentMembersInput): Promise<SegmentMembersPage> {
    const { list, count } = compileSegmentQuery(input);
    const first = input.first;
    return runReadScoped(this.deps.prisma, input.tenantId, async (client: TransactionClient) => {
      const rows = await client.$queryRawUnsafe<MemberSqlRow[]>(list.sql, ...list.params);
      const totals = await client.$queryRawUnsafe<TotalSqlRow[]>(count.sql, ...count.params);
      const hasNextPage = rows.length > first;
      const items = (hasNextPage ? rows.slice(0, first) : rows).map((row): SegmentMemberRow => ({
        id: row.id,
        name: row.name,
        email: row.email,
        isGuest: row.is_guest,
        ordersCount: toNumber(row.orders_count),
        amountSpentMinor: toNumber(row.spent_minor),
        lastOrderAt: row.last_order_at === null ? null : toIso(row.last_order_at),
        emailSubscribed: row.email_subscribed,
        smsSubscribed: row.sms_subscribed,
      }));
      return {
        items,
        pageInfo: { hasNextPage, endCursor: items.length > 0 ? (items.at(-1)?.id ?? null) : null },
        total: toNumber(totals[0]?.total ?? 0),
        currency: input.currency,
      };
    });
  }
}

/** The no-database wiring: segments cannot be evaluated, and saying so beats an empty list. */
export class UnavailableCustomerSegmentQuery implements CustomerSegmentQuery {
  members(): Promise<SegmentMembersPage> {
    return Promise.reject(new AppError("Segments need the database", { code: "UNAVAILABLE" }));
  }
}
