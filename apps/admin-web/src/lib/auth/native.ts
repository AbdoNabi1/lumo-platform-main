/** Plan 1B-2: native staff sign-in helpers (no Ory). Pure, so they are testable without Next. */

export function isNativeAuth(): boolean {
  return process.env["AUTH_MODE"] === "native";
}

/**
 * The runtime resolves a tenant for every route, JWKS included. Only native mode fetches the JWKS from
 * the runtime; in ory mode no header is added, so nothing changes until AUTH_MODE is switched.
 */
export function jwksFetchHeaders(): Record<string, string> {
  if (!isNativeAuth()) return {};
  return { "x-tenant-id": process.env["TENANT_DEFAULT_ID"] ?? "tenant-local" };
}

export type ExchangeResult =
  | { readonly ok: true; readonly token: string; readonly expiresIn: number }
  | { readonly ok: false; readonly reason: "invalid" | "mfa" | "unavailable" };

export async function exchangePassword(input: {
  readonly runtimeUrl: string;
  readonly tenantId: string;
  readonly email: string;
  readonly password: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<ExchangeResult> {
  const doFetch = input.fetchImpl ?? fetch;
  try {
    const response = await doFetch(`${input.runtimeUrl}/api/v1/public/auth/staff/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": input.tenantId },
      body: JSON.stringify({ email: input.email, password: input.password }),
      cache: "no-store",
    });
    if (response.status === 401) return { ok: false, reason: "invalid" };
    if (response.status === 403) return { ok: false, reason: "mfa" };
    if (!response.ok) return { ok: false, reason: "unavailable" };
    const body = (await response.json()) as { accessToken?: unknown; expiresIn?: unknown };
    if (typeof body.accessToken !== "string" || typeof body.expiresIn !== "number") {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true, token: body.accessToken, expiresIn: body.expiresIn };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
