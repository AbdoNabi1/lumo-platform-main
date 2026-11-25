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
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/config";
import { readSession } from "@/lib/auth/session";
import { requireProdEnv } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

const DEFAULT_RUNTIME_API_URL = "http://localhost:3080";
const DEFAULT_TENANT_ID = "tenant-local";

export type ApiResult<T> =
  | { readonly outcome: "ok"; readonly data: T }
  | {
      readonly outcome: "unauthorized";
      /** 403 when the API answered "signed in, but not allowed" (the owner-only screens say so); absent for a 401. */
      readonly status?: number;
    }
  | { readonly outcome: "not_found" }
  | {
      readonly outcome: "error";
      readonly message: string;
      /** The HTTP status when the API answered non-2xx; absent for a network failure or a bad body. */
      readonly status?: number;
      /** The API error envelope's `code` (for example `UNAVAILABLE`), when the body carried one. */
      readonly code?: string;
    };

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
  | {
      readonly outcome: "unauthorized";
      /** The reply's error code, only when the caller asked for it (`readCodeOn401`). */
      readonly code?: string;
    }
  | { readonly outcome: "forbidden" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "conflict"; readonly message: string; readonly code?: string }
  | {
      readonly outcome: "invalid";
      readonly message: string;
      readonly fields: readonly FieldIssue[];
      readonly code?: string;
    }
  | {
      readonly outcome: "error";
      readonly message: string;
      readonly code?: string;
      /** The HTTP status when the API answered non-2xx; absent for a network failure or a bad body. */
      readonly status?: number;
    };

/**
 * Resolves the same tenant id every admin-web request already sends as the `x-tenant-id` header
 * below — exported for the rare route (Licensing's `GET /usage-counters`, see `lib/api/
 * licensing.ts`) that also requires it as an explicit `tenantRef` querystring parameter, so that
 * caller doesn't duplicate the session/`TENANT_DEFAULT_ID` resolution or drift from the header
 * value. The signed-in store (the session token's `tenant_id` claim) wins; with no session it is
 * `TENANT_DEFAULT_ID`.
 */
export async function currentTenantRef(): Promise<string> {
  const session = await readSession();
  return session?.tenantId ?? requireProdEnv("TENANT_DEFAULT_ID", DEFAULT_TENANT_ID);
}

/** Whether the browser sent a session cookie at all (valid or not); `false` outside a request. */
async function hasSessionCookie(): Promise<boolean> {
  try {
    const value = (await cookies()).get(SESSION_COOKIE)?.value;
    return value !== undefined && value.length > 0;
  } catch {
    return false;
  }
}

/**
 * The shared preamble every admin-API call needs — resolved once so `getAdminApi`/`mutateAdminApi`
 * cannot drift apart. `ADMIN_API_TOKEN` stands in ONLY when there is no session cookie at all: a
 * cookie that is present but invalid or expired sends no credential, so the API answers 401 and the
 * screen shows its signed-out state instead of acting with the server's own token.
 */
async function adminRequestHeaders(): Promise<Record<string, string>> {
  const session = await readSession();
  const tenantId = session?.tenantId ?? requireProdEnv("TENANT_DEFAULT_ID", DEFAULT_TENANT_ID);
  const token =
    session !== null
      ? session.token
      : (await hasSessionCookie())
        ? undefined
        : process.env["ADMIN_API_TOKEN"];

  const headers: Record<string, string> = { "x-tenant-id": tenantId };
  if (token !== undefined && token.length > 0) {
    headers["authorization"] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * GETs `path` off the admin runtime API. Never throws — every failure mode is a typed outcome.
 *
 * A 401 and a 403 are both `unauthorized`. A screen that must tell them apart (the owner-only
 * pages: "signed in, but not allowed") opts in with `{ reportForbidden: true }`, which adds
 * `status: 403` to the 403 outcome only; every other caller sees exactly what it always did.
 */
export async function getAdminApi<T>(
  path: string,
  isValid: (value: unknown) => value is T,
  options: { readonly reportForbidden?: boolean } = {},
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
    return options.reportForbidden === true && response.status === 403
      ? { outcome: "unauthorized", status: 403 }
      : { outcome: "unauthorized" };
  }
  if (response.status === 404) {
    return { outcome: "not_found" };
  }
  if (!response.ok) {
    const envelope: unknown = await response.json().catch(() => null);
    const shape = envelope as {
      readonly code?: unknown;
      readonly error?: { readonly code?: unknown } | null;
    } | null;
    // The flat `{ code }` envelope or the nested `{ error: { code } }` one.
    const code = shape?.code ?? shape?.error?.code;
    return {
      outcome: "error",
      message: `Admin API responded with status ${response.status}`,
      status: response.status,
      ...(typeof code === "string" ? { code } : {}),
    };
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
    readonly timeoutMs?: number;
    /**
     * Report the reply's error `code` on a 401. Off by default: a 401 normally means "signed out",
     * but a route whose own refusal is a 401 (Wave 1e: `INVALID_PASSWORD` on turning two-step off)
     * needs the caller to tell the two apart.
     */
    readonly readCodeOn401?: boolean;
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
    response = await fetchWithTimeout(
      `${runtimeApiUrl}${path}`,
      {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: "no-store",
      },
      init.timeoutMs,
    );
  } catch (error) {
    return {
      outcome: "error",
      message: error instanceof Error ? error.message : "Network error reaching the admin API",
    };
  }

  const parsed: unknown = await response.json().catch(() => null);

  const envelope = parsed as {
    readonly message?: unknown;
    readonly code?: unknown;
    readonly fields?: unknown;
    readonly error?: { readonly code?: unknown } | null;
  } | null;
  // Two envelope shapes exist: the flat `{ code, message }` and the nested `{ error: { code, message } }`.
  const rawCode = envelope?.code ?? envelope?.error?.code;
  const code = typeof rawCode === "string" ? { code: rawCode } : {};
  if (response.status === 401) {
    return init.readCodeOn401 === true
      ? { outcome: "unauthorized", ...code }
      : { outcome: "unauthorized" };
  }
  if (response.status === 403) return { outcome: "forbidden" };
  if (response.status === 404) return { outcome: "not_found" };
  if (response.status === 409) {
    return {
      outcome: "conflict",
      message: typeof envelope?.message === "string" ? envelope.message : "Conflict",
      ...code,
    };
  }
  if (response.status === 422) {
    return {
      outcome: "invalid",
      message: typeof envelope?.message === "string" ? envelope.message : "Validation failed",
      fields: fieldIssuesOf(envelope?.fields),
      ...code,
    };
  }
  if (!response.ok) {
    return {
      outcome: "error",
      message: `Admin API responded with status ${response.status}`,
      ...code,
      status: response.status,
    };
  }

  if (!isValid(parsed)) {
    return { outcome: "error", message: "Admin API returned an unexpected response shape" };
  }
  return { outcome: "ok", data: parsed };
}

/**
 * The outcome of sending raw bytes (an image upload). The statuses an upload can meet that a JSON
 * write never does are their own outcomes, so a screen can say "too large" or "storage isn't set up"
 * instead of a generic failure.
 */
export type BinaryResult<T> =
  | { readonly outcome: "ok"; readonly data: T }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "unavailable" }
  | { readonly outcome: "too_large" }
  | { readonly outcome: "unsupported" }
  /** 422: the bytes were read and refused (for example the image's dimensions); `code` says why. */
  | { readonly outcome: "invalid"; readonly code: string; readonly detail: unknown }
  /** 409: the same Idempotency-Key is still in flight (a double submit), not a lost update. */
  | { readonly outcome: "conflict" }
  | { readonly outcome: "error"; readonly message: string };

/** Uploads need longer than a JSON call: up to 8 MB over a phone connection. */
const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * POSTs raw bytes to the admin runtime API — server-side only, like every function here (the bearer
 * credential must never reach the browser). `headers` carries the file name; the `Idempotency-Key`
 * and content type are set from the arguments.
 */
export async function sendAdminBinary<T>(
  path: string,
  init: {
    readonly body: Uint8Array;
    readonly contentType: string;
    readonly idempotencyKey: string;
    readonly headers?: Readonly<Record<string, string>>;
  },
  isValid: (value: unknown) => value is T,
): Promise<BinaryResult<T>> {
  const runtimeApiUrl = requireProdEnv("RUNTIME_API_URL", DEFAULT_RUNTIME_API_URL);
  const headers = {
    ...(await adminRequestHeaders()),
    ...init.headers,
    "content-type": init.contentType,
    "idempotency-key": init.idempotencyKey,
  };

  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${runtimeApiUrl}${path}`,
      { method: "POST", headers, body: init.body as BodyInit, cache: "no-store" },
      UPLOAD_TIMEOUT_MS,
    );
  } catch (error) {
    return {
      outcome: "error",
      message: error instanceof Error ? error.message : "Network error reaching the admin API",
    };
  }

  if (response.status === 401 || response.status === 403) return { outcome: "unauthorized" };
  if (response.status === 503) return { outcome: "unavailable" };
  if (response.status === 413) return { outcome: "too_large" };
  if (response.status === 415) return { outcome: "unsupported" };
  if (response.status === 409) return { outcome: "conflict" };
  if (response.status === 422) {
    const detail: unknown = await response.json().catch(() => null);
    const code =
      typeof (detail as { code?: unknown } | null)?.code === "string"
        ? (detail as { code: string }).code
        : "INVALID";
    return { outcome: "invalid", code, detail };
  }
  if (!response.ok) {
    return { outcome: "error", message: `Admin API responded with status ${response.status}` };
  }
  const parsed: unknown = await response.json().catch(() => null);
  if (!isValid(parsed)) {
    return { outcome: "error", message: "Admin API returned an unexpected response shape" };
  }
  return { outcome: "ok", data: parsed };
}

/** The outcome of fetching raw bytes (a waybill PDF). A 409 carries the order numbers that blocked it. */
export type BytesResult =
  | { readonly outcome: "ok"; readonly bytes: Uint8Array }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | {
      readonly outcome: "conflict";
      readonly code?: string;
      readonly orderNumbers: readonly string[];
    }
  | { readonly outcome: "error"; readonly message: string };

/**
 * POSTs a JSON body and reads the response as bytes — server-side only, like every function here.
 * The bytes are returned to the caller and never stored (waybills are personal data).
 */
export async function postAdminApiForBytes(
  path: string,
  body: unknown,
  timeoutMs = 30_000,
): Promise<BytesResult> {
  const runtimeApiUrl = requireProdEnv("RUNTIME_API_URL", DEFAULT_RUNTIME_API_URL);
  const headers = await adminRequestHeaders();
  headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${runtimeApiUrl}${path}`,
      { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" },
      timeoutMs,
    );
  } catch (error) {
    return {
      outcome: "error",
      message: error instanceof Error ? error.message : "Network error reaching the admin API",
    };
  }

  if (response.status === 401 || response.status === 403) return { outcome: "unauthorized" };
  if (response.status === 404) return { outcome: "not_found" };
  if (response.status === 409) {
    const envelope = (await response.json().catch(() => null)) as {
      readonly code?: unknown;
      readonly orderNumbers?: unknown;
    } | null;
    return {
      outcome: "conflict",
      ...(typeof envelope?.code === "string" ? { code: envelope.code } : {}),
      orderNumbers: Array.isArray(envelope?.orderNumbers)
        ? envelope.orderNumbers.filter((n): n is string => typeof n === "string")
        : [],
    };
  }
  if (!response.ok) {
    return { outcome: "error", message: `Admin API responded with status ${response.status}` };
  }
  try {
    return { outcome: "ok", bytes: new Uint8Array(await response.arrayBuffer()) };
  } catch (error) {
    return {
      outcome: "error",
      message: error instanceof Error ? error.message : "Could not read the admin API response",
    };
  }
}
