import { getAdminApi, mutateAdminApi, type ApiResult, type MutationResult } from "./client";
import type { OrderAddressDto } from "./orders";

export interface CustomerListItemDto {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export interface CustomersPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface CustomersPageDto {
  readonly items: readonly CustomerListItemDto[];
  readonly pageInfo: CustomersPageInfo;
}

function isCustomersPageDto(value: unknown): value is CustomersPageDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

export interface CustomersListQuery {
  readonly first?: number;
  readonly after?: string;
  readonly search?: string;
}

export type FetchCustomersPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly CustomerListItemDto[];
      readonly pageInfo: CustomersPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a filtered, cursor-paginated page of customers for the Customers list screen. */
export async function fetchCustomersPage(
  query: CustomersListQuery,
): Promise<FetchCustomersPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);
  if (query.search !== undefined) params.set("search", query.search);

  const result = await getAdminApi(`/api/v1/customers?${params.toString()}`, isCustomersPageDto);
  if (result.outcome === "ok") {
    return { outcome: "ok", items: result.data.items, pageInfo: result.data.pageInfo };
  }
  if (result.outcome === "unauthorized") {
    return { outcome: "unauthorized" };
  }
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}

export interface CustomerConsentDto {
  readonly scope: string;
  readonly granted: boolean;
  readonly occurredAt: string;
}

export type CustomerLanguage = "en" | "ar";

export interface CustomerDetailDto {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly addresses: readonly OrderAddressDto[];
  readonly consents: readonly CustomerConsentDto[];
  readonly phone: string | null;
  readonly language: CustomerLanguage | null;
  readonly isGuest: boolean;
  readonly note: string | null;
  readonly tags: readonly string[];
  /** The current staff-asserted marketing state per channel (default: not subscribed). */
  readonly marketing: { readonly email: boolean; readonly sms: boolean };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isLanguageOrNull(value: unknown): value is CustomerLanguage | null {
  return value === null || value === "en" || value === "ar";
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isAddress(value: unknown): value is OrderAddressDto {
  return (
    isRecord(value) &&
    typeof value["line1"] === "string" &&
    typeof value["city"] === "string" &&
    typeof value["postalCode"] === "string" &&
    typeof value["country"] === "string"
  );
}

function isConsent(value: unknown): value is CustomerConsentDto {
  return (
    isRecord(value) &&
    typeof value["scope"] === "string" &&
    typeof value["granted"] === "boolean" &&
    typeof value["occurredAt"] === "string"
  );
}

function isMarketing(value: unknown): value is CustomerDetailDto["marketing"] {
  return (
    isRecord(value) && typeof value["email"] === "boolean" && typeof value["sms"] === "boolean"
  );
}

function isCustomerDetailDto(value: unknown): value is CustomerDetailDto {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["name"] === "string" &&
    typeof value["email"] === "string" &&
    Array.isArray(value["addresses"]) &&
    value["addresses"].every(isAddress) &&
    Array.isArray(value["consents"]) &&
    value["consents"].every(isConsent) &&
    isStringOrNull(value["phone"]) &&
    isLanguageOrNull(value["language"]) &&
    typeof value["isGuest"] === "boolean" &&
    isStringOrNull(value["note"]) &&
    isStringArray(value["tags"]) &&
    isMarketing(value["marketing"])
  );
}

export type FetchCustomerResult =
  | { readonly outcome: "ok"; readonly customer: CustomerDetailDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a customer by id (resolves an order's `customerRef` for the Order Detail screen, and the Customer Detail screen itself). */
export async function fetchCustomer(customerId: string): Promise<FetchCustomerResult> {
  const result = await getAdminApi(
    `/api/v1/customers/${encodeURIComponent(customerId)}`,
    isCustomerDetailDto,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", customer: result.data };
  }
  if (result.outcome === "error") {
    return { outcome: "error", message: result.message };
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Shopify parity Wave 1b — staff-side customer writes and the export read (Task 4's routes).
// Server-side only, like every other client in this folder: call them from a Server Action or a
// route handler, never from a Client Component.
// ---------------------------------------------------------------------------------------------

export interface CreateCustomerBody {
  readonly name: string;
  readonly email: string;
  readonly phone?: string;
  readonly language?: CustomerLanguage;
  readonly note?: string;
  readonly tags?: readonly string[];
  /** A staff assertion, recorded as the `marketing` consent scope — not proof the shopper opted in. */
  readonly marketingEmail?: boolean;
  /** A staff assertion, recorded as the `marketing_sms` consent scope. */
  readonly marketingSms?: boolean;
}

interface CustomerIdDto {
  readonly customerId: string;
}
interface CustomerNoteDto extends CustomerIdDto {
  readonly note: string | null;
}
interface CustomerTagsDto extends CustomerIdDto {
  readonly tags: readonly string[];
}
interface CustomerMarketingDto extends CustomerIdDto {
  readonly email: boolean;
  readonly sms: boolean;
}

function hasCustomerId(value: unknown): value is CustomerIdDto {
  return isRecord(value) && typeof value["customerId"] === "string";
}
function isCustomerNoteDto(value: unknown): value is CustomerNoteDto {
  return hasCustomerId(value) && isStringOrNull((value as { note?: unknown }).note);
}
function isCustomerTagsDto(value: unknown): value is CustomerTagsDto {
  return hasCustomerId(value) && isStringArray((value as { tags?: unknown }).tags);
}
function isCustomerMarketingDto(value: unknown): value is CustomerMarketingDto {
  return (
    hasCustomerId(value) &&
    typeof (value as { email?: unknown }).email === "boolean" &&
    typeof (value as { sms?: unknown }).sms === "boolean"
  );
}

const customerPath = (customerId: string): string =>
  `/api/v1/customers/${encodeURIComponent(customerId)}`;

/** `POST /customers` (`customers:register`, idempotent) — 201 `{ customerId }`; 409 for a duplicate email. */
export function createCustomer(
  body: CreateCustomerBody,
  idempotencyKey: string,
): Promise<MutationResult<{ customerId: string }>> {
  return mutateAdminApi(
    "/api/v1/customers",
    { method: "POST", body, idempotencyKey },
    hasCustomerId,
  );
}

/** `POST /customers/:id` (`customers:update`) — only the keys present change; `null` clears phone / language. */
export function updateCustomerProfile(
  customerId: string,
  body: {
    readonly name?: string;
    readonly phone?: string | null;
    readonly language?: CustomerLanguage | null;
  },
  idempotencyKey: string,
): Promise<MutationResult<{ customerId: string }>> {
  return mutateAdminApi(
    customerPath(customerId),
    { method: "POST", body, idempotencyKey },
    hasCustomerId,
  );
}

/** `POST /customers/:id/note` (`customers:update`) — `null` clears the note. */
export function setCustomerNote(
  customerId: string,
  note: string | null,
  idempotencyKey: string,
): Promise<MutationResult<{ customerId: string; note: string | null }>> {
  return mutateAdminApi(
    `${customerPath(customerId)}/note`,
    { method: "POST", body: { note }, idempotencyKey },
    isCustomerNoteDto,
  );
}

/** `POST /customers/:id/tags` (`customers:update`) — replaces the whole tag set. */
export function setCustomerTags(
  customerId: string,
  tags: readonly string[],
  idempotencyKey: string,
): Promise<MutationResult<{ customerId: string; tags: readonly string[] }>> {
  return mutateAdminApi(
    `${customerPath(customerId)}/tags`,
    { method: "POST", body: { tags }, idempotencyKey },
    isCustomerTagsDto,
  );
}

/** `POST /customers/:id/marketing-consent` (`customers:change_consent`) — only the channel(s) given change. */
export function changeMarketingConsent(
  customerId: string,
  body: { readonly email?: boolean; readonly sms?: boolean },
  idempotencyKey: string,
): Promise<MutationResult<{ customerId: string; email: boolean; sms: boolean }>> {
  return mutateAdminApi(
    `${customerPath(customerId)}/marketing-consent`,
    { method: "POST", body, idempotencyKey },
    isCustomerMarketingDto,
  );
}

/** One CSV-ready row of `GET /customers/export-rows`. */
export interface CustomerExportRowDto {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly language: CustomerLanguage | null;
  readonly emailMarketing: boolean;
  readonly smsMarketing: boolean;
  readonly tags: readonly string[];
  readonly note: string | null;
  readonly isGuest: boolean;
  /** The first address on file, or `null`. */
  readonly address: {
    readonly line1: string;
    readonly city: string;
    readonly postalCode: string;
    readonly country: string;
  } | null;
}

export interface CustomerExportPage {
  readonly items: readonly CustomerExportRowDto[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
}

function isCustomerExportRowDto(value: unknown): value is CustomerExportRowDto {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["name"] === "string" &&
    typeof value["email"] === "string" &&
    isStringOrNull(value["phone"]) &&
    isLanguageOrNull(value["language"]) &&
    typeof value["emailMarketing"] === "boolean" &&
    typeof value["smsMarketing"] === "boolean" &&
    isStringArray(value["tags"]) &&
    isStringOrNull(value["note"]) &&
    typeof value["isGuest"] === "boolean" &&
    (value["address"] === null || isAddress(value["address"]))
  );
}

function isCustomerExportPage(value: unknown): value is CustomerExportPage {
  if (!isRecord(value) || !Array.isArray(value["items"])) return false;
  const pageInfo = value["pageInfo"];
  return (
    value["items"].every(isCustomerExportRowDto) &&
    isRecord(pageInfo) &&
    typeof pageInfo["hasNextPage"] === "boolean" &&
    isStringOrNull(pageInfo["endCursor"])
  );
}

/** `GET /customers/export-rows` (`customers:export`) — one cursor page for the CSV (`first` ≤ 100). */
export function fetchCustomerExportPage(query: {
  readonly first?: number;
  readonly after?: string;
  readonly search?: string;
}): Promise<ApiResult<CustomerExportPage>> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);
  if (query.search !== undefined) params.set("search", query.search);
  const queryString = params.toString();
  return getAdminApi(
    `/api/v1/customers/export-rows${queryString === "" ? "" : `?${queryString}`}`,
    isCustomerExportPage,
  );
}
