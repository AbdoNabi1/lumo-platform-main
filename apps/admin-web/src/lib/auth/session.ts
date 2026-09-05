import { cookies } from "next/headers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { readRolesClaim, readStringClaim } from "./claims";
import { authConfig, SESSION_COOKIE } from "./config";

export { SESSION_COOKIE } from "./config";

export type Role = "viewer" | "operator" | "admin";
const ROLE_RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };

export interface AdminSession {
  readonly token: string;
  readonly principalId: string;
  readonly kind: string;
  readonly roles: readonly string[];
  /** From Kratos identity traits (identity.schema.json's only trait) — real, never invented. */
  readonly email: string | undefined;
}

/** Highest of the known role tiers present in `roles`, or `undefined` if none are recognized. */
export function highestRole(roles: readonly string[]): Role | undefined {
  const known = roles.filter(
    (role): role is Role => role === "admin" || role === "operator" || role === "viewer",
  );
  if (known.length === 0) return undefined;
  return known.reduce((highest, role) => (ROLE_RANK[role] > ROLE_RANK[highest] ? role : highest));
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
function getJwks() {
  jwks ??= createRemoteJWKSet(new URL(authConfig.jwksUrl));
  return jwks;
}

/**
 * Verifies the admin session cookie the same way the Admin API's `JwtVerifier`
 * (`packages/auth/src/jwt-verifier.ts`) verifies the bearer header — same issuer/audience/JWKS.
 * Invalid or expired resolves `null`, never throws (mirrors that adapter's contract).
 */
export async function readSession(): Promise<AdminSession | null> {
  let token: string | undefined;
  try {
    token = (await cookies()).get(SESSION_COOKIE)?.value;
  } catch {
    // No request scope to read cookies from (e.g. unit tests, build-time rendering) — no session.
    return null;
  }
  if (token === undefined || token.length === 0) return null;
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: authConfig.issuerUrl,
      audience: authConfig.audience,
    });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
    // Hydra nests the consent UI's `session.access_token` claims under `ext` — see ./claims.ts for
    // why reading only the top level silently produced a role-less session on every real login.
    const claims = payload as Record<string, unknown>;
    const roles = readRolesClaim(claims);
    const kind = readStringClaim(claims, "kind") ?? "customer";
    const email = readStringClaim(claims, "email");
    return { token, principalId: payload.sub, kind, roles, email };
  } catch {
    return null;
  }
}
