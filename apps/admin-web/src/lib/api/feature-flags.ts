import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

/**
 * T5.11b — Feature Flags (`apps/admin/src/http/feature-flags-routes.ts`). No frontend existed for
 * this domain before this task. Note this is a **different** backend domain from the existing
 * read-only Feature Registry screen (`app/feature-registry`, `lib/api/feature-registry.ts`,
 * `services/feature-registry` — a capability/dependency graph of application features): this file
 * is `services/feature-flags`, boolean/percentage rollout toggles.
 *
 * List/get are fully DTO-mapped on the backend (`toFeatureFlagDto`), so the read side here follows
 * `lib/api/notifications.ts`'s `fetchNotificationsPage`/`fetchNotification` pattern exactly. The 5
 * write routes don't map their responses through `toFeatureFlagDto`
 * (`featureFlagsRoutes`'s handlers return whatever `admin.featureFlags` returns directly, unmapped)
 * — same discipline `lib/api/notifications.ts`'s doc comment describes for its own write routes:
 * read only an `id` off the create response, nothing off the rest, and let the caller
 * `revalidatePath` to pick up the real, DTO-mapped state.
 */

export interface FeatureEnvironmentDto {
  readonly environment: string;
  readonly enabled: boolean;
  readonly rolloutPercentage: number | null;
}

export interface FeatureRuleDto {
  readonly type: string;
  readonly attribute: string | null;
  readonly values: readonly string[];
  readonly enabled: boolean;
}

export interface FlagChangeDto {
  readonly action: string;
  readonly changedBy: string;
  readonly details: string | null;
  readonly occurredAt: string;
}

export interface FeatureFlagDto {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: string;
  readonly environments: readonly FeatureEnvironmentDto[];
  readonly rules: readonly FeatureRuleDto[];
  readonly rolloutPercentage: number;
  readonly changes: readonly FlagChangeDto[];
}

export interface FeatureFlagsPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface FeatureFlagsPageDto {
  readonly items: readonly FeatureFlagDto[];
  readonly pageInfo: FeatureFlagsPageInfo;
}

function isFeatureFlagsPageDto(value: unknown): value is FeatureFlagsPageDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

function isFeatureFlagDto(value: unknown): value is FeatureFlagDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

export type FetchFeatureFlagsPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly FeatureFlagDto[];
      readonly pageInfo: FeatureFlagsPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a cursor-paginated page of feature flags (`GET /feature-flags`, `feature_flags:read`). */
export async function fetchFeatureFlagsPage(query: {
  readonly first?: number;
  readonly after?: string;
}): Promise<FetchFeatureFlagsPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);

  const result = await getAdminApi(
    `/api/v1/feature-flags?${params.toString()}`,
    isFeatureFlagsPageDto,
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

export type FetchFeatureFlagResult =
  | { readonly outcome: "ok"; readonly flag: FeatureFlagDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a single feature flag (`GET /feature-flags/:flagId`, `feature_flags:read`). */
export async function fetchFeatureFlag(flagId: string): Promise<FetchFeatureFlagResult> {
  const result = await getAdminApi(
    `/api/v1/feature-flags/${encodeURIComponent(flagId)}`,
    isFeatureFlagDto,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", flag: result.data };
  }
  if (result.outcome === "error") {
    return { outcome: "error", message: result.message };
  }
  return result;
}

function isUnknown(_value: unknown): _value is unknown {
  return true;
}

function isCreatedRecord(value: unknown): value is { readonly id?: unknown } {
  return typeof value === "object" && value !== null;
}

function flagPath(flagId: string, suffix = ""): string {
  return `/api/v1/feature-flags/${encodeURIComponent(flagId)}${suffix}`;
}

export interface CreateFeatureFlagInput {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
}

/** `POST /feature-flags` (`idempotent: true`, `feature_flags:create`) — created active, 0% rollout. */
export async function createFeatureFlag(
  input: CreateFeatureFlagInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/feature-flags",
    { method: "POST", body: input, idempotencyKey },
    isCreatedRecord,
  );
  if (result.outcome !== "ok") return result;
  const id = typeof result.data.id === "string" ? result.data.id : "";
  return { outcome: "ok", data: { id } };
}

export type FeatureFlagStatus = "active" | "killed" | "archived";

/**
 * `POST /feature-flags/:flagId/transitions` (`idempotent: true`, `feature_flags:advance`) — the
 * only status-changing route (see `lib/feature-flag-lifecycle.ts`). `changedBy` is an audit-trail
 * actor id the operator types (or the current admin user's id, pre-filled), separate from auth/
 * session identity.
 */
export function advanceFeatureFlag(
  flagId: string,
  toStatus: FeatureFlagStatus,
  changedBy: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    flagPath(flagId, "/transitions"),
    { method: "POST", body: { toStatus, changedBy }, idempotencyKey },
    isUnknown,
  );
}

/** `POST /feature-flags/:flagId/rollout` (`idempotent: true`, `feature_flags:set_rollout`). */
export function setFeatureFlagRollout(
  flagId: string,
  percentage: number,
  changedBy: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    flagPath(flagId, "/rollout"),
    { method: "POST", body: { percentage, changedBy }, idempotencyKey },
    isUnknown,
  );
}

export interface AddFeatureFlagRuleInput {
  readonly type: "tenant" | "user" | "attribute";
  readonly values: readonly string[];
  readonly enabled: boolean;
  readonly attribute?: string;
  readonly changedBy: string;
}

/**
 * `POST /feature-flags/:flagId/rules` (**not** idempotent — no `Idempotency-Key` sent, per the
 * route table — `feature_flags:add_rule`).
 */
export function addFeatureFlagRule(
  flagId: string,
  input: AddFeatureFlagRuleInput,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(flagPath(flagId, "/rules"), { method: "POST", body: input }, isUnknown);
}

export interface SetFeatureFlagEnvironmentOverrideInput {
  readonly environment: string;
  readonly enabled: boolean;
  readonly rolloutPercentage?: number;
  readonly changedBy: string;
}

/**
 * `POST /feature-flags/:flagId/environment-overrides` (`idempotent: true`,
 * `feature_flags:set_environment_override`).
 */
export function setFeatureFlagEnvironmentOverride(
  flagId: string,
  input: SetFeatureFlagEnvironmentOverrideInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    flagPath(flagId, "/environment-overrides"),
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}
