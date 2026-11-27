import { getAdminApi, mutateAdminApi, type ApiResult, type MutationResult } from "./client";

/**
 * Shopify parity Wave 1c — Customers > Segments. Wire types mirror `apps/admin`'s
 * `/api/v1/customer-segments` routes (Identity's `SegmentView` / `SegmentCondition`, the admin
 * app's `SegmentMembersPage`). Server-side only, like every client in this folder: call from a
 * Server Component or a Server Action, never from a Client Component.
 */

export type SegmentCmp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
export type SegmentDayOp = "within_last_days" | "not_within_last_days";
export type SegmentDateOp = "on_or_after" | "before";

export type SegmentCondition =
  | { readonly field: "orders_count"; readonly op: SegmentCmp; readonly value: number }
  | { readonly field: "amount_spent"; readonly op: SegmentCmp; readonly valueMinor: number }
  | { readonly field: "last_order_date"; readonly op: SegmentDayOp; readonly days: number }
  | { readonly field: "last_order_date"; readonly op: SegmentDateOp; readonly date: string }
  | { readonly field: "last_order_date"; readonly op: "never" }
  | { readonly field: "email_subscribed"; readonly value: boolean }
  | { readonly field: "sms_subscribed"; readonly value: boolean }
  | {
      readonly field: "tags";
      readonly op: "has_any" | "has_all" | "has_none";
      readonly values: readonly string[];
    }
  | { readonly field: "country"; readonly op: "in" | "not_in"; readonly values: readonly string[] }
  | { readonly field: "created_date"; readonly op: SegmentDayOp; readonly days: number }
  | { readonly field: "created_date"; readonly op: SegmentDateOp; readonly date: string }
  | { readonly field: "language"; readonly op: "eq" | "neq"; readonly value: "en" | "ar" }
  | { readonly field: "language"; readonly op: "unset" };

export type SegmentField = SegmentCondition["field"];

export interface SegmentView {
  readonly id: string;
  readonly kind: "default" | "custom";
  /** The default segment's key (`purchasedAtLeastOnce`…); `null` for a custom segment. */
  readonly key: string | null;
  /** The custom segment's name; `null` for a default segment (its label is localized). */
  readonly name: string | null;
  /** The custom segment's optimistic-concurrency version; `null` for a default segment. */
  readonly version: number | null;
  readonly conditions: readonly SegmentCondition[];
  readonly updatedAt: string | null;
}

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

export interface SegmentMembersPage {
  readonly items: readonly SegmentMemberRow[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
  readonly total: number;
  /** The shop currency every amount on the page is in. */
  readonly currency: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

const CMP_OPS: readonly string[] = ["eq", "neq", "gt", "gte", "lt", "lte"];
const DAY_OPS: readonly string[] = ["within_last_days", "not_within_last_days"];
const DATE_OPS: readonly string[] = ["on_or_after", "before"];

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** True for exactly the condition shapes Identity produces; anything else is a contract break. */
export function isSegmentCondition(value: unknown): value is SegmentCondition {
  if (!isRecord(value)) return false;
  const { field, op } = value;
  switch (field) {
    case "orders_count":
      return typeof op === "string" && CMP_OPS.includes(op) && isNonNegativeInteger(value["value"]);
    case "amount_spent":
      return (
        typeof op === "string" && CMP_OPS.includes(op) && isNonNegativeInteger(value["valueMinor"])
      );
    case "last_order_date":
      return op === "never" || isDayOrDate(op, value);
    case "created_date":
      return isDayOrDate(op, value);
    case "email_subscribed":
    case "sms_subscribed":
      return typeof value["value"] === "boolean";
    case "tags":
      return (
        (op === "has_any" || op === "has_all" || op === "has_none") &&
        isStringArray(value["values"])
      );
    case "country":
      return (op === "in" || op === "not_in") && isStringArray(value["values"]);
    case "language":
      if (op === "unset") return true;
      return (op === "eq" || op === "neq") && (value["value"] === "en" || value["value"] === "ar");
    default:
      return false;
  }
}

function isDayOrDate(op: unknown, value: Record<string, unknown>): boolean {
  if (typeof op !== "string") return false;
  if (DAY_OPS.includes(op)) return isNonNegativeInteger(value["days"]);
  if (DATE_OPS.includes(op)) return typeof value["date"] === "string";
  return false;
}

export function isSegmentView(value: unknown): value is SegmentView {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    (value["kind"] === "default" || value["kind"] === "custom") &&
    isNullableString(value["key"]) &&
    isNullableString(value["name"]) &&
    (value["version"] === null || isNonNegativeInteger(value["version"])) &&
    Array.isArray(value["conditions"]) &&
    value["conditions"].every(isSegmentCondition) &&
    isNullableString(value["updatedAt"])
  );
}

function isSegmentList(value: unknown): value is { readonly items: readonly SegmentView[] } {
  return isRecord(value) && Array.isArray(value["items"]) && value["items"].every(isSegmentView);
}

function isMemberRow(value: unknown): value is SegmentMemberRow {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["name"] === "string" &&
    typeof value["email"] === "string" &&
    typeof value["isGuest"] === "boolean" &&
    isNonNegativeInteger(value["ordersCount"]) &&
    typeof value["amountSpentMinor"] === "number" &&
    Number.isFinite(value["amountSpentMinor"]) &&
    isNullableString(value["lastOrderAt"]) &&
    typeof value["emailSubscribed"] === "boolean" &&
    typeof value["smsSubscribed"] === "boolean"
  );
}

export function isSegmentMembersPage(value: unknown): value is SegmentMembersPage {
  if (!isRecord(value) || !Array.isArray(value["items"])) return false;
  const pageInfo = value["pageInfo"];
  return (
    value["items"].every(isMemberRow) &&
    isRecord(pageInfo) &&
    typeof pageInfo["hasNextPage"] === "boolean" &&
    isNullableString(pageInfo["endCursor"]) &&
    isNonNegativeInteger(value["total"]) &&
    typeof value["currency"] === "string" &&
    value["currency"].length > 0
  );
}

function isCurrencyDto(value: unknown): value is { readonly currency: string } {
  return isRecord(value) && typeof value["currency"] === "string" && value["currency"].length > 0;
}

function isSegmentIdDto(value: unknown): value is { readonly segmentId: string } {
  return isRecord(value) && typeof value["segmentId"] === "string";
}

function isSegmentVersionDto(
  value: unknown,
): value is { readonly segmentId: string; readonly version: number } {
  return isSegmentIdDto(value) && isNonNegativeInteger((value as { version?: unknown }).version);
}

const segmentPath = (segmentId: string): string =>
  `/api/v1/customer-segments/${encodeURIComponent(segmentId)}`;

/** `GET /customer-segments` (`customers:read`) — the four defaults first, then custom segments by name. */
export function fetchCustomerSegments(): Promise<ApiResult<{ items: readonly SegmentView[] }>> {
  return getAdminApi("/api/v1/customer-segments", isSegmentList);
}

/** `GET /customer-segments/:id` (`customers:read`) — 404 → `not_found`. */
export function fetchCustomerSegment(segmentId: string): Promise<ApiResult<SegmentView>> {
  return getAdminApi(segmentPath(segmentId), isSegmentView);
}

/** `GET /customer-segments/store-currency` (`customers:read`) — the currency the money fields are in. */
export function fetchSegmentStoreCurrency(): Promise<ApiResult<{ currency: string }>> {
  return getAdminApi("/api/v1/customer-segments/store-currency", isCurrencyDto);
}

/** `GET /customer-segments/:id/members` — one cursor page with the live total and the shop currency. */
export function fetchSegmentMembers(
  segmentId: string,
  query: { readonly first?: number; readonly after?: string; readonly search?: string } = {},
): Promise<ApiResult<SegmentMembersPage>> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);
  if (query.search !== undefined) params.set("search", query.search);
  const queryString = params.toString();
  return getAdminApi(
    `${segmentPath(segmentId)}/members${queryString === "" ? "" : `?${queryString}`}`,
    isSegmentMembersPage,
  );
}

/** `POST /customer-segments` (`customers:manage_segments`, idempotent) — 201 `{ segmentId }`. */
export function createCustomerSegment(
  body: { readonly name: string; readonly conditions: readonly SegmentCondition[] },
  idempotencyKey: string,
): Promise<MutationResult<{ segmentId: string }>> {
  return mutateAdminApi(
    "/api/v1/customer-segments",
    { method: "POST", body, idempotencyKey },
    isSegmentIdDto,
  );
}

/** `POST /customer-segments/:id` (`customers:manage_segments`, idempotent) — 200 `{ segmentId, version }`. */
export function updateCustomerSegment(
  segmentId: string,
  body: {
    readonly expectedVersion: number;
    readonly name?: string;
    readonly conditions?: readonly SegmentCondition[];
  },
  idempotencyKey: string,
): Promise<MutationResult<{ segmentId: string; version: number }>> {
  return mutateAdminApi(
    segmentPath(segmentId),
    { method: "POST", body, idempotencyKey },
    isSegmentVersionDto,
  );
}

/** `POST /customer-segments/:id/delete` (`customers:manage_segments`, idempotent) — custom segments only. */
export function deleteCustomerSegment(
  segmentId: string,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<MutationResult<{ segmentId: string }>> {
  return mutateAdminApi(
    `${segmentPath(segmentId)}/delete`,
    { method: "POST", body: { expectedVersion }, idempotencyKey },
    isSegmentIdDto,
  );
}

/**
 * `POST /customer-segments/preview` (`customers:read`) — the total and first members of UNSAVED
 * conditions. A read, so it carries NO `Idempotency-Key` (the route is not idempotent).
 */
export function previewCustomerSegment(
  conditions: readonly SegmentCondition[],
  first?: number,
): Promise<MutationResult<SegmentMembersPage>> {
  return mutateAdminApi(
    "/api/v1/customer-segments/preview",
    { method: "POST", body: { conditions, ...(first === undefined ? {} : { first }) } },
    isSegmentMembersPage,
  );
}
