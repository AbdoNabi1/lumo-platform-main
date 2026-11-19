import type { LocalizedText } from "@platform/storefront-content";
import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

/**
 * T5.9a — Dynamic Pages (`apps/admin/src/http/pages-routes.ts`). Both `Page` and `Template` list
 * + get routes are fully DTO-mapped on the backend (`toPageDto`/`toTemplateDto`), so the read
 * side here follows `lib/api/products.ts`'s `fetchProductsPage`/`fetchProduct` pattern exactly.
 * The 4 write routes return the domain aggregate or nothing mappable, same as every other Phase 5
 * write route — see the doc comment on `createPage` below.
 */

export interface PageDto {
  readonly id: string;
  readonly name: string;
  readonly routePath: string;
  readonly templateRef: string | null;
  readonly experienceRef: string | null;
  readonly seoProfileRef: string | null;
  readonly localeRef: string | null;
  readonly status: string;
  /** Part 2 (spec 2.4): the merchant's text. An empty title displays `name` (Ruling 16). */
  readonly title: LocalizedText;
  readonly metaDescription: LocalizedText;
  /** Morbeh text. Absent on list rows (Ruling 17): read the page itself to edit it. */
  readonly body?: LocalizedText;
  readonly publishedAt: string | null;
  readonly updatedAt: string | null;
  /** What a content save sends back as `expectedVersion`. */
  readonly version: number;
}

export interface TemplateDto {
  readonly id: string;
  readonly name: string;
  readonly experienceRef: string;
  readonly status: string;
}

export interface PagesPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface PagesPageDto {
  readonly items: readonly PageDto[];
  readonly pageInfo: PagesPageInfo;
}

interface TemplatesPageDto {
  readonly items: readonly TemplateDto[];
  readonly pageInfo: PagesPageInfo;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

/** A list row: no body (Ruling 17), but the title and the version are always there. */
function isPageRow(value: unknown): value is PageDto {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["name"] === "string" &&
    typeof value["routePath"] === "string" &&
    typeof value["status"] === "string" &&
    isRecord(value["title"]) &&
    isRecord(value["metaDescription"]) &&
    isNullableString(value["publishedAt"]) &&
    isNullableString(value["updatedAt"]) &&
    typeof value["version"] === "number" &&
    Number.isInteger(value["version"])
  );
}

function isPagesPageDto(value: unknown): value is PagesPageDto {
  return isRecord(value) && Array.isArray(value["items"]) && value["items"].every(isPageRow);
}

function isTemplatesPageDto(value: unknown): value is TemplatesPageDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

/** One page, as the editor needs it: with its body. */
function isPageDto(value: unknown): value is PageDto & { readonly body: LocalizedText } {
  return isPageRow(value) && isRecord(value["body"]);
}

function isTemplateDto(value: unknown): value is TemplateDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

export type FetchPagesPageResult =
  | { readonly outcome: "ok"; readonly items: readonly PageDto[]; readonly pageInfo: PagesPageInfo }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a cursor-paginated page of pages for the Pages list screen (`GET /pages`, `pages:read`). */
export async function fetchPagesPage(query: {
  readonly first?: number;
  readonly after?: string;
}): Promise<FetchPagesPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);

  const result = await getAdminApi(`/api/v1/pages?${params.toString()}`, isPagesPageDto);
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

export type FetchPageResult =
  | { readonly outcome: "ok"; readonly page: PageDto & { readonly body: LocalizedText } }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a single page for the Page Detail screen (`GET /pages/:pageId`, `pages:read`). */
export async function fetchPage(pageId: string): Promise<FetchPageResult> {
  const result = await getAdminApi(`/api/v1/pages/${encodeURIComponent(pageId)}`, isPageDto);
  if (result.outcome === "ok") {
    return { outcome: "ok", page: result.data };
  }
  if (result.outcome === "error") {
    return { outcome: "error", message: result.message };
  }
  return result;
}

export type FetchTemplatesPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly TemplateDto[];
      readonly pageInfo: PagesPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a cursor-paginated page of templates (`GET /templates`, `pages:read`). */
export async function fetchTemplatesPage(query: {
  readonly first?: number;
  readonly after?: string;
}): Promise<FetchTemplatesPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);

  const result = await getAdminApi(`/api/v1/templates?${params.toString()}`, isTemplatesPageDto);
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

export type FetchTemplateResult =
  | { readonly outcome: "ok"; readonly template: TemplateDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a single template for the Template Detail screen (`GET /templates/:templateId`, `pages:read`). */
export async function fetchTemplate(templateId: string): Promise<FetchTemplateResult> {
  const result = await getAdminApi(
    `/api/v1/templates/${encodeURIComponent(templateId)}`,
    isTemplateDto,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", template: result.data };
  }
  if (result.outcome === "error") {
    return { outcome: "error", message: result.message };
  }
  return result;
}

/**
 * The 4 write routes below don't map their responses through `toPageDto`/`toTemplateDto`
 * (`admin.pages.createPage`/`.advancePage`/`.createTemplate`/`.archiveTemplate` return the domain
 * aggregate or nothing mappable directly) — same discipline `lib/api/products.ts`'s doc comment
 * describes for its own write routes: read only an `id` off a create response, nothing off the
 * rest, and let the caller `revalidatePath` to pick up the real, DTO-mapped state.
 */

function isUnknown(_value: unknown): _value is unknown {
  return true;
}

function isCreatedRecord(
  value: unknown,
): value is { readonly id?: unknown; readonly pageId?: unknown } {
  return typeof value === "object" && value !== null;
}

export interface CreatePageInput {
  readonly name: string;
  readonly routePath: string;
  readonly templateRef?: string;
  readonly experienceRef?: string;
  readonly seoProfileRef?: string;
  readonly localeRef?: string;
  /** Part 2 (Ruling 17): "Add page" sends the content in the same call. */
  readonly title?: LocalizedText;
  readonly body?: LocalizedText;
  readonly metaDescription?: LocalizedText;
}

/**
 * `POST /pages` (`idempotent: true`, `pages:create_page`). The answer is `{ pageId, status }`;
 * `id` is still read for an older API.
 */
export async function createPage(
  input: CreatePageInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/pages",
    { method: "POST", body: input, idempotencyKey },
    isCreatedRecord,
  );
  if (result.outcome !== "ok") return result;
  const { pageId, id } = result.data;
  return {
    outcome: "ok",
    data: { id: typeof pageId === "string" ? pageId : typeof id === "string" ? id : "" },
  };
}

const isContentSaved = (value: unknown): value is { pageId: string; version: number } =>
  isRecord(value) &&
  typeof value["pageId"] === "string" &&
  typeof value["version"] === "number" &&
  Number.isInteger(value["version"]);

/**
 * `PUT /pages/:pageId/content` (`pages:update_page`): replaces the title, body and meta
 * description of a draft or published page, guarded by `expectedVersion`. One key per save.
 */
export function updatePageContent(
  pageId: string,
  body: {
    title: LocalizedText;
    body: LocalizedText;
    metaDescription: LocalizedText;
    expectedVersion: number;
  },
  idempotencyKey: string,
): Promise<MutationResult<{ pageId: string; version: number }>> {
  return mutateAdminApi(
    `/api/v1/pages/${encodeURIComponent(pageId)}/content`,
    { method: "PUT", body, idempotencyKey },
    isContentSaved,
  );
}

/** `POST /pages/:pageId/transitions` (`idempotent: true`, `pages:advance_page`). */
export function advancePage(
  pageId: string,
  toStatus: "draft" | "published" | "archived",
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/pages/${encodeURIComponent(pageId)}/transitions`,
    { method: "POST", body: { toStatus }, idempotencyKey },
    isUnknown,
  );
}

export interface CreateTemplateInput {
  readonly name: string;
  readonly experienceRef: string;
}

/** `POST /templates` (`idempotent: true`, `pages:create_template`). */
export async function createTemplate(
  input: CreateTemplateInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/templates",
    { method: "POST", body: input, idempotencyKey },
    isCreatedRecord,
  );
  if (result.outcome !== "ok") return result;
  const id = typeof result.data.id === "string" ? result.data.id : "";
  return { outcome: "ok", data: { id } };
}

/** `POST /templates/:templateId/archive` (`idempotent: true`, `pages:archive_template`). */
export function archiveTemplate(
  templateId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/templates/${encodeURIComponent(templateId)}/archive`,
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}
