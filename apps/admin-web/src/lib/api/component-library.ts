import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

/**
 * T5.9c — Component Library (`apps/admin/src/http/components-routes.ts`). No frontend existed
 * for this domain before this task. Named `component-library.ts` (not `components.ts`) and routed
 * under `/components-library` (not `/components`) to avoid colliding with this app's existing
 * `src/components/` directory convention — see the task brief. The wire path itself is still the
 * real backend route, `/components`. Same read/write discipline as `lib/api/theme.ts`.
 */

export interface ComponentPropertyDto {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
}

export interface ComponentDefinitionDto {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly properties: readonly ComponentPropertyDto[];
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly slots: readonly string[];
  readonly events: readonly string[];
  readonly responsive: boolean;
  readonly permission: string | null;
  readonly featureFlagKey: string | null;
  readonly status: string;
}

export interface ComponentsPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface ComponentsPageDto {
  readonly items: readonly ComponentDefinitionDto[];
  readonly pageInfo: ComponentsPageInfo;
}

function isComponentsPageDto(value: unknown): value is ComponentsPageDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

function isComponentDefinitionDto(value: unknown): value is ComponentDefinitionDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

export interface ComponentsListQuery {
  readonly first?: number;
  readonly after?: string;
}

export type FetchComponentsPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly ComponentDefinitionDto[];
      readonly pageInfo: ComponentsPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/**
 * Fetches a cursor-paginated page of component definitions for the Components list screen
 * (`GET /components`, `components:read`).
 */
export async function fetchComponentsPage(
  query: ComponentsListQuery,
): Promise<FetchComponentsPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);

  const result = await getAdminApi(`/api/v1/components?${params.toString()}`, isComponentsPageDto);
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

export type FetchComponentResult =
  | { readonly outcome: "ok"; readonly component: ComponentDefinitionDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/**
 * Fetches a single component definition for the Component Detail screen
 * (`GET /components/:componentDefinitionId`, `components:read`).
 */
export async function fetchComponent(
  componentDefinitionId: string,
): Promise<FetchComponentResult> {
  const result = await getAdminApi(
    `/api/v1/components/${encodeURIComponent(componentDefinitionId)}`,
    isComponentDefinitionDto,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", component: result.data };
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

export type ComponentPropertyType = "string" | "number" | "boolean" | "object" | "array";

export interface ComponentPropertyInput {
  readonly name: string;
  readonly type: ComponentPropertyType;
  readonly required: boolean;
}

export interface CreateComponentInput {
  readonly key: string;
  readonly name: string;
  readonly properties: readonly ComponentPropertyInput[];
  readonly defaults?: Readonly<Record<string, unknown>>;
  readonly slots: readonly string[];
  readonly events: readonly string[];
  readonly responsive: boolean;
  readonly permission?: string;
  readonly featureFlagKey?: string;
}

/** `POST /components` (`idempotent: true`, `components:create`). */
export async function createComponent(
  input: CreateComponentInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/components",
    { method: "POST", body: input, idempotencyKey },
    isCreatedRecord,
  );
  if (result.outcome !== "ok") return result;
  const id = typeof result.data.id === "string" ? result.data.id : "";
  return { outcome: "ok", data: { id } };
}

export type ComponentStatus = "draft" | "published" | "deprecated" | "archived";

/** `POST /components/:componentDefinitionId/transitions` (`idempotent: true`, `components:advance`). */
export function advanceComponent(
  componentDefinitionId: string,
  toStatus: ComponentStatus,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/components/${encodeURIComponent(componentDefinitionId)}/transitions`,
    { method: "POST", body: { toStatus }, idempotencyKey },
    isUnknown,
  );
}
