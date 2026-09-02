import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

/**
 * T5.9c — Theme (`apps/admin/src/http/theme-routes.ts`). No frontend existed for this domain
 * before this task. The list/get routes are fully DTO-mapped (`toThemeDto`), so the read side
 * follows `lib/api/categories.ts`'s `fetchCategoriesPage`/pattern exactly. The 3 write routes
 * don't map their responses through `toThemeDto` — same discipline `lib/api/pages.ts`'s doc
 * comment describes for its own write routes: read only an `id` off the create response, nothing
 * off the rest, and let the caller `revalidatePath` to pick up the real, DTO-mapped state.
 */

export interface ThemeVersionDto {
  readonly versionNumber: number;
  readonly publishedAt: string;
}

export interface ThemeDto {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly colors: Readonly<Record<string, string>>;
  readonly typography: Readonly<Record<string, string>>;
  readonly spacing: Readonly<Record<string, string>>;
  readonly versions: readonly ThemeVersionDto[];
}

export interface ThemesPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface ThemesPageDto {
  readonly items: readonly ThemeDto[];
  readonly pageInfo: ThemesPageInfo;
}

function isThemesPageDto(value: unknown): value is ThemesPageDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

function isThemeDto(value: unknown): value is ThemeDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

export interface ThemesListQuery {
  readonly first?: number;
  readonly after?: string;
}

export type FetchThemesPageResult =
  | { readonly outcome: "ok"; readonly items: readonly ThemeDto[]; readonly pageInfo: ThemesPageInfo }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a cursor-paginated page of themes for the Theme list screen (`GET /themes`, `theme:read`). */
export async function fetchThemesPage(query: ThemesListQuery): Promise<FetchThemesPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);

  const result = await getAdminApi(`/api/v1/themes?${params.toString()}`, isThemesPageDto);
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

export type FetchThemeResult =
  | { readonly outcome: "ok"; readonly theme: ThemeDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a single theme for the Theme Detail screen (`GET /themes/:themeId`, `theme:read`). */
export async function fetchTheme(themeId: string): Promise<FetchThemeResult> {
  const result = await getAdminApi(`/api/v1/themes/${encodeURIComponent(themeId)}`, isThemeDto);
  if (result.outcome === "ok") {
    return { outcome: "ok", theme: result.data };
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

export interface CreateThemeInput {
  readonly name: string;
  readonly presetKey: string;
}

/** `POST /themes` (`idempotent: true`, `theme:create`). */
export async function createTheme(
  input: CreateThemeInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/themes",
    { method: "POST", body: input, idempotencyKey },
    isCreatedRecord,
  );
  if (result.outcome !== "ok") return result;
  const id = typeof result.data.id === "string" ? result.data.id : "";
  return { outcome: "ok", data: { id } };
}

export type ThemeStatus = "draft" | "active" | "archived";

/** `POST /themes/:themeId/transitions` (`idempotent: true`, `theme:advance`). */
export function advanceTheme(
  themeId: string,
  toStatus: ThemeStatus,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/themes/${encodeURIComponent(themeId)}/transitions`,
    { method: "POST", body: { toStatus }, idempotencyKey },
    isUnknown,
  );
}

export interface UpdateThemeVariablesInput {
  readonly colors: Readonly<Record<string, string>>;
  readonly typography: Readonly<Record<string, string>>;
  readonly spacing: Readonly<Record<string, string>>;
}

/**
 * `POST /themes/:themeId/variables` (`idempotent: true`, `theme:update_variables`) — full replace,
 * draft-only per the route's own summary ("Update a draft theme's variables"); the caller
 * (`ThemeVariablesEditor`) only renders this form when `status === "draft"`.
 */
export function updateThemeVariables(
  themeId: string,
  input: UpdateThemeVariablesInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/themes/${encodeURIComponent(themeId)}/variables`,
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}
