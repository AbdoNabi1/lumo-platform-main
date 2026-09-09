/**
 * Shared server-only fetch helper for the runtime admin API (`apps/runtime`, served by
 * `apps/admin`'s routes) — factored out of `orders.ts`'s original `fetchRecentOrders` so
 * `customers.ts`/`payments.ts` don't duplicate the same auth/error handling. Server-side only,
 * never called from browser JS: the runtime API has no CORS configured
 * (`packages/http/src/server.ts`), and a bearer credential must never reach client code.
 * `RUNTIME_API_URL`/`TENANT_DEFAULT_ID` reuse the same env vars `apps/storefront/src/lib/
 * runtime-api.ts` already reads for the same runtime process — not new configuration surface.
 *
 * Phase A.32: `admin-web` now has a real per-request session (the Hydra-issued JWT in the
 * `morbeh_admin_session` cookie — see `lib/auth/session.ts` and `middleware.ts`), so the logged-in
 * staff member's own token is forwarded when present. `ADMIN_API_TOKEN` remains the fallback
 * server-to-server credential for contexts with no session (e.g. build-time rendering) — its
 * absence or rejection by the API is a normal, expected outcome here (`"unauthorized"`), not an
 * error to hide.
 *
 * Phase A.34 (A.33 P0 #7, P1 #6): `RUNTIME_API_URL`/`TENANT_DEFAULT_ID` now fail closed outside
 * `APP_ENV=local|development` instead of silently targeting `localhost` (`lib/env.ts`), and every
 * fetch has a timeout (`lib/fetch-with-timeout.ts`) so a hung Admin API no longer hangs this
 * Suspense boundary indefinitely.
 */
import { readSession } from "@/lib/auth/session";
import { requireProdEnv } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

const DEFAULT_RUNTIME_API_URL = "http://localhost:3080";
const DEFAULT_TENANT_ID = "tenant-local";

export type ApiResult<T> =
  | { readonly outcome: "ok"; readonly data: T }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** One field-level validation failure, as returned in the API error envelope's `fields`. */
export interface FieldIssue {
  readonly field: string;
  readonly message: string;
}

/**
 * The outcome of a write. Richer than `ApiResult` on purpose: a 422 carries per-field issues
 * that a form must render next to the offending input, and a 409 is a distinct, user-actionable
 * state (someone else changed this record / this key is already in flight) rather than a
 * generic error.
 */
export type MutationResult<T> =
  | { readonly outcome: "ok"; readonly data: T }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "forbidden" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "conflict"; readonly message: string }
  | {
      readonly outcome: "invalid";
      readonly message: string;
      readonly fields: readonly FieldIssue[];
    }
  | { readonly outcome: "error"; readonly message: string };

/**
 * Resolves the same tenant id every admin-web request already sends as the `x-tenant-id` header
 * below — exported for the rare route (Licensing's `GET /usage-counters`, see `lib/api/
 * licensing.ts`) that also requires it as an explicit `tenantRef` querystring parameter, so that
 * caller doesn't duplicate `TENANT_DEFAULT_ID`/`DEFAULT_TENANT_ID` resolution or drift from the
 * header value.
 */
export function currentTenantRef(): string {
  return requireProdEnv("TENANT_DEFAULT_ID", DEFAULT_TENANT_ID);
}

/** The shared preamble every admin-API call needs — resolved once so `getAdminApi`/`mutateAdminApi` cannot drift apart. */
async function adminRequestHeaders(): Promise<Record<string, string>> {
  const tenantId = requireProdEnv("TENANT_DEFAULT_ID", DEFAULT_TENANT_ID);
  const session = await readSession();
  const token = session?.token ?? process.env["ADMIN_API_TOKEN"];

  const headers: Record<string, string> = { "x-tenant-id": tenantId };
  if (token !== undefined && token.length > 0) {
    headers["authorization"] = `Bearer ${token}`;
  }
  return headers;
}

/** GETs `path` off the admin runtime API. Never throws — every failure mode is a typed outcome. */
export async function getAdminApi<T>(
  path: string,
  isValid: (value: unknown) => value is T,
): Promise<ApiResult<T>> {
  const runtimeApiUrl = requireProdEnv("RUNTIME_API_URL", DEFAULT_RUNTIME_API_URL);
  const headers = await adminRequestHeaders();

  let response: Response;
  try {
    response = await fetchWithTimeout(`${runtimeApiUrl}${path}`, { headers, cache: "no-store" });
  } catch (error) {
    return {
      outcome: "error",
      message: error instanceof Error ? error.message : "Network error reaching the admin API",
    };
  }

  if (response.status === 401 || response.status === 403) {
    return { outcome: "unauthorized" };
  }
  if (response.status === 404) {
    return { outcome: "not_found" };
  }
  if (!response.ok) {
    return { outcome: "error", message: `Admin API responded with status ${response.status}` };
  }

  const body: unknown = await response.json();
  if (!isValid(body)) {
    return { outcome: "error", message: "Admin API returned an unexpected response shape" };
  }
  return { outcome: "ok", data: body };
}

function fieldIssuesOf(value: unknown): readonly FieldIssue[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is FieldIssue =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as { field?: unknown }).field === "string" &&
      typeof (item as { message?: unknown }).message === "string",
  );
}

/**
 * Sends a write to the admin runtime API. Never throws — every failure mode is a typed outcome,
 * same discipline as `getAdminApi`.
 *
 * Server-side only, exactly like `getAdminApi`: the runtime API has no CORS configured
 * (`packages/http/src/server.ts`) and the bearer credential must never reach client code. Call
 * this from a Server Action, never from a Client Component.
 *
 * `idempotencyKey` maps to the `Idempotency-Key` request header, which
 * `packages/http/src/server.ts` honours for every route declared `idempotent: true` — which is
 * nearly all of them. Callers should pass a fresh key per user-initiated submit (not per retry),
 * so that a double-click or a Server Action replay cannot create two records.
 */
export async function mutateAdminApi<T>(
  path: string,
  init: {
    readonly method: "POST" | "PUT" | "PATCH" | "DELETE";
    readonly body?: unknown;
    readonly idempotencyKey?: string;
  },
  isValid: (value: unknown) => value is T,
): Promise<MutationResult<T>> {
  const runtimeApiUrl = requireProdEnv("RUNTIME_API_URL", DEFAULT_RUNTIME_API_URL);
  const headers = await adminRequestHeaders();
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (init.idempotencyKey !== undefined) {
    headers["idempotency-key"] = init.idempotencyKey;
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(`${runtimeApiUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch (error) {
    return {
      outcome: "error",
      message: error instanceof Error ? error.message : "Network error reaching the admin API",
    };
  }

  const parsed: unknown = await response.json().catch(() => null);

  if (response.status === 401) return { outcome: "unauthorized" };
  if (response.status === 403) return { outcome: "forbidden" };
  if (response.status === 404) return { outcome: "not_found" };
  if (response.status === 409) {
    const envelope = parsed as { readonly message?: unknown } | null;
    return {
      outcome: "conflict",
      message: typeof envelope?.message === "string" ? envelope.message : "Conflict",
    };
  }
  if (response.status === 422) {
    const envelope = parsed as { readonly message?: unknown; readonly fields?: unknown } | null;
    return {
      outcome: "invalid",
      message: typeof envelope?.message === "string" ? envelope.message : "Validation failed",
      fields: fieldIssuesOf(envelope?.fields),
    };
  }
  if (!response.ok) {
    return { outcome: "error", message: `Admin API responded with status ${response.status}` };
  }

  if (!isValid(parsed)) {
    return { outcome: "error", message: "Admin API returned an unexpected response shape" };
  }
  return { outcome: "ok", data: parsed };
}
