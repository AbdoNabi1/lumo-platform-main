import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

/**
 * T5.9b — SEO (`apps/admin/src/http/seo-routes.ts`). All 4 list+get routes are fully DTO-mapped
 * (`toSeoProfileDto`/`toRedirectDto`/`toSitemapDto`/`toRobotsPolicyDto`), so the read side here
 * follows `lib/api/pages.ts`'s `fetchPagesPage`/`fetchPage` pattern exactly. The 5 write routes
 * don't map their responses through those DTOs (`admin.seo.setSeoProfile`/`.createRedirect`/
 * `.createSitemap`/`.regenerateSitemap`/`.setRobotsPolicy` return the domain aggregate or nothing
 * mappable directly) — same discipline `lib/api/pages.ts`'s doc comment describes: read only an
 * `id` off a create/set response when present, nothing off the rest, and let the caller
 * `revalidatePath` to pick up the real, DTO-mapped state.
 *
 * No `Redirect`/`Sitemap`/`RobotsPolicy` delete/deactivate route exists on the backend
 * (`seo-routes.ts` read in full) — none is exposed here either. A redirect's `active` field has no
 * route that sets it directly; redirects are create-only from this task's perspective.
 */

export interface SeoProfileDto {
  readonly id: string;
  readonly pageRef: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly canonicalUrl: string | null;
  readonly ogImageRef: string | null;
}

export interface RedirectDto {
  readonly id: string;
  readonly fromPath: string;
  readonly toPath: string;
  readonly statusCode: number;
  readonly active: boolean;
}

export interface SitemapDto {
  readonly id: string;
  readonly name: string;
  readonly urls: readonly string[];
  readonly lastGeneratedAt: string | null;
}

export type RobotsRuleType = "allow" | "disallow";

export interface RobotsRule {
  readonly type: RobotsRuleType;
  readonly path: string;
}

export interface RobotsPolicyDto {
  readonly id: string;
  readonly userAgent: string;
  readonly rules: readonly RobotsRule[];
}

export interface SeoPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPageDtoOf<T>(itemGuard: (value: unknown) => value is T) {
  return (value: unknown): value is { readonly items: readonly T[]; readonly pageInfo: SeoPageInfo } =>
    isObject(value) && Array.isArray(value["items"]) && value["items"].every(itemGuard);
}

function hasId(value: Record<string, unknown>): boolean {
  return typeof value["id"] === "string";
}

function isSeoProfileDto(value: unknown): value is SeoProfileDto {
  return (
    isObject(value) &&
    hasId(value) &&
    typeof value["pageRef"] === "string" &&
    (typeof value["title"] === "string" || value["title"] === null) &&
    (typeof value["description"] === "string" || value["description"] === null) &&
    (typeof value["canonicalUrl"] === "string" || value["canonicalUrl"] === null) &&
    (typeof value["ogImageRef"] === "string" || value["ogImageRef"] === null)
  );
}

function isRedirectDto(value: unknown): value is RedirectDto {
  return (
    isObject(value) &&
    hasId(value) &&
    typeof value["fromPath"] === "string" &&
    typeof value["toPath"] === "string" &&
    typeof value["statusCode"] === "number" &&
    typeof value["active"] === "boolean"
  );
}

function isSitemapDto(value: unknown): value is SitemapDto {
  return (
    isObject(value) &&
    hasId(value) &&
    typeof value["name"] === "string" &&
    Array.isArray(value["urls"]) &&
    value["urls"].every((url) => typeof url === "string") &&
    (typeof value["lastGeneratedAt"] === "string" || value["lastGeneratedAt"] === null)
  );
}

function isRobotsRule(value: unknown): value is RobotsRule {
  return (
    isObject(value) &&
    (value["type"] === "allow" || value["type"] === "disallow") &&
    typeof value["path"] === "string"
  );
}

function isRobotsPolicyDto(value: unknown): value is RobotsPolicyDto {
  return (
    isObject(value) &&
    hasId(value) &&
    typeof value["userAgent"] === "string" &&
    Array.isArray(value["rules"]) &&
    value["rules"].every(isRobotsRule)
  );
}

const isSeoProfilesPageDto = isPageDtoOf(isSeoProfileDto);
const isRedirectsPageDto = isPageDtoOf(isRedirectDto);
const isSitemapsPageDto = isPageDtoOf(isSitemapDto);
const isRobotsPoliciesPageDto = isPageDtoOf(isRobotsPolicyDto);

interface ListQuery {
  readonly first?: number;
  readonly after?: string;
}

function listParams(query: ListQuery): string {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);
  return params.toString();
}

export type FetchSeoProfilesPageResult =
  | { readonly outcome: "ok"; readonly items: readonly SeoProfileDto[]; readonly pageInfo: SeoPageInfo }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a cursor-paginated page of SEO profiles for the SEO Profiles list screen (`GET /seo/profiles`, `seo:read`). */
export async function fetchSeoProfilesPage(query: ListQuery): Promise<FetchSeoProfilesPageResult> {
  const result = await getAdminApi(`/api/v1/seo/profiles?${listParams(query)}`, isSeoProfilesPageDto);
  if (result.outcome === "ok") {
    return { outcome: "ok", items: result.data.items, pageInfo: result.data.pageInfo };
  }
  if (result.outcome === "unauthorized") {
    return { outcome: "unauthorized" };
  }
  return { outcome: "error", message: result.outcome === "not_found" ? "Not found" : result.message };
}

export type FetchSeoProfileResult =
  | { readonly outcome: "ok"; readonly profile: SeoProfileDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a single SEO profile for the SEO Profile Detail screen (`GET /seo/profiles/:profileId`, `seo:read`). */
export async function fetchSeoProfile(profileId: string): Promise<FetchSeoProfileResult> {
  const result = await getAdminApi(
    `/api/v1/seo/profiles/${encodeURIComponent(profileId)}`,
    isSeoProfileDto,
  );
  if (result.outcome === "ok") return { outcome: "ok", profile: result.data };
  if (result.outcome === "error") return { outcome: "error", message: result.message };
  return result;
}

export type FetchRedirectsPageResult =
  | { readonly outcome: "ok"; readonly items: readonly RedirectDto[]; readonly pageInfo: SeoPageInfo }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a cursor-paginated page of redirects for the Redirects list screen (`GET /seo/redirects`, `seo:read`). */
export async function fetchRedirectsPage(query: ListQuery): Promise<FetchRedirectsPageResult> {
  const result = await getAdminApi(`/api/v1/seo/redirects?${listParams(query)}`, isRedirectsPageDto);
  if (result.outcome === "ok") {
    return { outcome: "ok", items: result.data.items, pageInfo: result.data.pageInfo };
  }
  if (result.outcome === "unauthorized") {
    return { outcome: "unauthorized" };
  }
  return { outcome: "error", message: result.outcome === "not_found" ? "Not found" : result.message };
}

export type FetchRedirectResult =
  | { readonly outcome: "ok"; readonly redirect: RedirectDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a single redirect (`GET /seo/redirects/:redirectId`, `seo:read`). */
export async function fetchRedirect(redirectId: string): Promise<FetchRedirectResult> {
  const result = await getAdminApi(
    `/api/v1/seo/redirects/${encodeURIComponent(redirectId)}`,
    isRedirectDto,
  );
  if (result.outcome === "ok") return { outcome: "ok", redirect: result.data };
  if (result.outcome === "error") return { outcome: "error", message: result.message };
  return result;
}

export type FetchSitemapsPageResult =
  | { readonly outcome: "ok"; readonly items: readonly SitemapDto[]; readonly pageInfo: SeoPageInfo }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a cursor-paginated page of sitemaps for the Sitemaps list screen (`GET /seo/sitemaps`, `seo:read`). */
export async function fetchSitemapsPage(query: ListQuery): Promise<FetchSitemapsPageResult> {
  const result = await getAdminApi(`/api/v1/seo/sitemaps?${listParams(query)}`, isSitemapsPageDto);
  if (result.outcome === "ok") {
    return { outcome: "ok", items: result.data.items, pageInfo: result.data.pageInfo };
  }
  if (result.outcome === "unauthorized") {
    return { outcome: "unauthorized" };
  }
  return { outcome: "error", message: result.outcome === "not_found" ? "Not found" : result.message };
}

export type FetchSitemapResult =
  | { readonly outcome: "ok"; readonly sitemap: SitemapDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a single sitemap for the Sitemap Detail screen (`GET /seo/sitemaps/:sitemapId`, `seo:read`). */
export async function fetchSitemap(sitemapId: string): Promise<FetchSitemapResult> {
  const result = await getAdminApi(
    `/api/v1/seo/sitemaps/${encodeURIComponent(sitemapId)}`,
    isSitemapDto,
  );
  if (result.outcome === "ok") return { outcome: "ok", sitemap: result.data };
  if (result.outcome === "error") return { outcome: "error", message: result.message };
  return result;
}

export type FetchRobotsPoliciesPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly RobotsPolicyDto[];
      readonly pageInfo: SeoPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a cursor-paginated page of robots policies (`GET /seo/robots-policies`, `seo:read`). */
export async function fetchRobotsPoliciesPage(
  query: ListQuery,
): Promise<FetchRobotsPoliciesPageResult> {
  const result = await getAdminApi(
    `/api/v1/seo/robots-policies?${listParams(query)}`,
    isRobotsPoliciesPageDto,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", items: result.data.items, pageInfo: result.data.pageInfo };
  }
  if (result.outcome === "unauthorized") {
    return { outcome: "unauthorized" };
  }
  return { outcome: "error", message: result.outcome === "not_found" ? "Not found" : result.message };
}

export type FetchRobotsPolicyResult =
  | { readonly outcome: "ok"; readonly policy: RobotsPolicyDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a single robots policy (`GET /seo/robots-policies/:policyId`, `seo:read`). */
export async function fetchRobotsPolicy(policyId: string): Promise<FetchRobotsPolicyResult> {
  const result = await getAdminApi(
    `/api/v1/seo/robots-policies/${encodeURIComponent(policyId)}`,
    isRobotsPolicyDto,
  );
  if (result.outcome === "ok") return { outcome: "ok", policy: result.data };
  if (result.outcome === "error") return { outcome: "error", message: result.message };
  return result;
}

/**
 * The 5 write routes below don't map their responses through the DTOs above — same discipline
 * `lib/api/pages.ts`'s doc comment describes for its own write routes: read only an `id` off a
 * create/set response, nothing off the rest, and let the caller `revalidatePath` to pick up the
 * real, DTO-mapped state.
 */

function isUnknown(_value: unknown): _value is unknown {
  return true;
}

function isCreatedRecord(value: unknown): value is { readonly id?: unknown } {
  return typeof value === "object" && value !== null;
}

export interface SetSeoProfileInput {
  readonly pageRef: string;
  readonly title?: string;
  readonly description?: string;
  readonly canonicalUrl?: string;
  readonly ogImageRef?: string;
}

/** `POST /seo/profiles` (`idempotent: true`, `seo:set_profile`) — create-or-update keyed by `pageRef`. */
export async function setSeoProfile(
  input: SetSeoProfileInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/seo/profiles",
    { method: "POST", body: input, idempotencyKey },
    isCreatedRecord,
  );
  if (result.outcome !== "ok") return result;
  const id = typeof result.data.id === "string" ? result.data.id : "";
  return { outcome: "ok", data: { id } };
}

export interface CreateRedirectInput {
  readonly fromPath: string;
  readonly toPath: string;
  readonly statusCode: 301 | 302;
}

/** `POST /seo/redirects` (`idempotent: true`, `seo:create_redirect`). */
export async function createRedirect(
  input: CreateRedirectInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/seo/redirects",
    { method: "POST", body: input, idempotencyKey },
    isCreatedRecord,
  );
  if (result.outcome !== "ok") return result;
  const id = typeof result.data.id === "string" ? result.data.id : "";
  return { outcome: "ok", data: { id } };
}

export interface CreateSitemapInput {
  readonly name: string;
}

/** `POST /seo/sitemaps` (`idempotent: true`, `seo:create_sitemap`). */
export async function createSitemap(
  input: CreateSitemapInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/seo/sitemaps",
    { method: "POST", body: input, idempotencyKey },
    isCreatedRecord,
  );
  if (result.outcome !== "ok") return result;
  const id = typeof result.data.id === "string" ? result.data.id : "";
  return { outcome: "ok", data: { id } };
}

/** `POST /seo/sitemaps/:sitemapId/regenerate` (`idempotent: true`, `seo:regenerate_sitemap`). */
export function regenerateSitemap(
  sitemapId: string,
  urls: readonly string[],
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/seo/sitemaps/${encodeURIComponent(sitemapId)}/regenerate`,
    { method: "POST", body: { urls }, idempotencyKey },
    isUnknown,
  );
}

export interface SetRobotsPolicyInput {
  readonly userAgent: string;
  readonly rules: readonly RobotsRule[];
}

/** `POST /seo/robots-policies` (`idempotent: true`, `seo:set_robots_policy`) — create-or-update keyed by `userAgent`. */
export async function setRobotsPolicy(
  input: SetRobotsPolicyInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/seo/robots-policies",
    { method: "POST", body: input, idempotencyKey },
    isCreatedRecord,
  );
  if (result.outcome !== "ok") return result;
  const id = typeof result.data.id === "string" ? result.data.id : "";
  return { outcome: "ok", data: { id } };
}
