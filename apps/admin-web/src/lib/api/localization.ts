import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

/**
 * T5.11a — Localization (`apps/admin/src/http/localization-routes.ts`). No frontend existed for
 * this domain before this task. List/get are fully DTO-mapped on the backend (`toLocaleDto`/
 * `toTranslationSetDto`), so the read side here follows `lib/api/reviews.ts`'s
 * `fetchReviewsPage`/`fetchReview` pattern exactly. The 4 write routes don't map their responses
 * through a DTO (`LocalizationAdminController`'s handlers return whatever the domain layer returns
 * directly, unmapped) — same discipline `lib/api/reviews.ts`'s doc comment describes: read only an
 * `id` off a create response, nothing off the rest, and let the caller `revalidatePath` to pick up
 * the real, DTO-mapped state. There is no update or delete route for either resource — `isDefault`/
 * `status` on `LocaleDto` and each translation's own `status` are read-only from this task's
 * perspective except via the dedicated `publish` route.
 */

export interface LocaleDto {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly fallbackLocaleRef: string | null;
  readonly status: string;
}

export interface TranslationDto {
  readonly key: string;
  readonly value: string;
  readonly status: string;
}

export interface TranslationSetDto {
  readonly id: string;
  readonly localeRef: string;
  readonly namespace: string;
  readonly translations: readonly TranslationDto[];
}

export interface LocalizationPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface LocalesPageDto {
  readonly items: readonly LocaleDto[];
  readonly pageInfo: LocalizationPageInfo;
}

interface TranslationSetsPageDto {
  readonly items: readonly TranslationSetDto[];
  readonly pageInfo: LocalizationPageInfo;
}

function isLocalesPageDto(value: unknown): value is LocalesPageDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

function isTranslationSetsPageDto(value: unknown): value is TranslationSetsPageDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

function isLocaleDto(value: unknown): value is LocaleDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

function isTranslationSetDto(value: unknown): value is TranslationSetDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    Array.isArray((value as { translations?: unknown }).translations)
  );
}

export type FetchLocalesPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly LocaleDto[];
      readonly pageInfo: LocalizationPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a cursor-paginated page of locales (`GET /locales`, `localization:read`). */
export async function fetchLocalesPage(query: {
  readonly first?: number;
  readonly after?: string;
}): Promise<FetchLocalesPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);

  const result = await getAdminApi(`/api/v1/locales?${params.toString()}`, isLocalesPageDto);
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

export type FetchLocaleResult =
  | { readonly outcome: "ok"; readonly locale: LocaleDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a single locale (`GET /locales/:localeId`, `localization:read`). */
export async function fetchLocale(localeId: string): Promise<FetchLocaleResult> {
  const result = await getAdminApi(`/api/v1/locales/${encodeURIComponent(localeId)}`, isLocaleDto);
  if (result.outcome === "ok") {
    return { outcome: "ok", locale: result.data };
  }
  if (result.outcome === "error") {
    return { outcome: "error", message: result.message };
  }
  return result;
}

export type FetchTranslationSetsPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly TranslationSetDto[];
      readonly pageInfo: LocalizationPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a cursor-paginated page of translation sets (`GET /translation-sets`, `localization:read`). */
export async function fetchTranslationSetsPage(query: {
  readonly first?: number;
  readonly after?: string;
}): Promise<FetchTranslationSetsPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);

  const result = await getAdminApi(
    `/api/v1/translation-sets?${params.toString()}`,
    isTranslationSetsPageDto,
  );
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

export type FetchTranslationSetResult =
  | { readonly outcome: "ok"; readonly translationSet: TranslationSetDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a single translation set (`GET /translation-sets/:translationSetId`, `localization:read`). */
export async function fetchTranslationSet(
  translationSetId: string,
): Promise<FetchTranslationSetResult> {
  const result = await getAdminApi(
    `/api/v1/translation-sets/${encodeURIComponent(translationSetId)}`,
    isTranslationSetDto,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", translationSet: result.data };
  }
  if (result.outcome === "error") {
    return { outcome: "error", message: result.message };
  }
  return result;
}

function isCreatedRecord(value: unknown): value is { readonly id?: unknown } {
  return typeof value === "object" && value !== null;
}

function isUnknown(_value: unknown): _value is unknown {
  return true;
}

export interface CreateLocaleInput {
  readonly code: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly fallbackLocaleRef?: string;
}

/** `POST /locales` (`idempotent: true`, `localization:create_locale`). */
export async function createLocale(
  input: CreateLocaleInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/locales",
    { method: "POST", body: input, idempotencyKey },
    isCreatedRecord,
  );
  if (result.outcome !== "ok") return result;
  const id = typeof result.data.id === "string" ? result.data.id : "";
  return { outcome: "ok", data: { id } };
}

export interface CreateTranslationSetInput {
  readonly localeRef: string;
  readonly namespace: string;
}

/** `POST /translation-sets` (`idempotent: true`, `localization:create_set`). */
export async function createTranslationSet(
  input: CreateTranslationSetInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/translation-sets",
    { method: "POST", body: input, idempotencyKey },
    isCreatedRecord,
  );
  if (result.outcome !== "ok") return result;
  const id = typeof result.data.id === "string" ? result.data.id : "";
  return { outcome: "ok", data: { id } };
}

/**
 * `POST /translation-sets/:translationSetId/translations` (`idempotent: true`,
 * `localization:set_translation`) — upserts one translation value.
 */
export function setTranslation(
  translationSetId: string,
  input: { readonly key: string; readonly value: string },
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/translation-sets/${encodeURIComponent(translationSetId)}/translations`,
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

/**
 * `POST /translation-sets/:translationSetId/translations/publish` (`idempotent: true`,
 * `localization:publish_translation`) — publishes a draft translation by key. Offered
 * unconditionally per translation row (the DTO's `status` enum isn't confirmed beyond the field
 * existing, per the task brief), so a same-status resubmit is a harmless no-op/backend-rejected
 * attempt rather than a fabricated client-side gate.
 */
export function publishTranslation(
  translationSetId: string,
  key: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/translation-sets/${encodeURIComponent(translationSetId)}/translations/publish`,
    { method: "POST", body: { key }, idempotencyKey },
    isUnknown,
  );
}
