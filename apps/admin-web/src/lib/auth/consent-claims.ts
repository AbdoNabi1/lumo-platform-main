import { authConfig } from "./config";
import { oryAdminHeaders } from "./ory-admin";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

/**
 * The `kind`/`roles`/`email` claims `app/consent/page.tsx` puts into the access token.
 *
 * Two topologies reach the consent page:
 *
 *  - **Self-hosted Ory / our own `/login`**: `app/login/page.tsx` accepts the Hydra login request with
 *    a `context` carrying the identity's `kind`/`roles`/`email`, and Hydra hands that context back on
 *    the consent request.
 *  - **Ory Network's hosted login** (the Account Experience renders the sign-in form on Ory's own
 *    domain, so no shared cookie with admin-web is needed): nothing of ours ever sees the login
 *    request, so the consent request has a `subject` but no `context`. The claims are then read from
 *    the identity itself. `metadata_public` is writable only through the Admin API, never by the user,
 *    which is why it is a safe source for roles — the same field `/login` reads them from.
 */
export interface ConsentClaims {
  readonly kind: string;
  readonly roles: readonly string[];
  readonly email: string | undefined;
}

export interface ConsentRequestInfo {
  readonly subject?: string;
  readonly context?: {
    readonly kind?: string;
    readonly roles?: readonly string[];
    readonly email?: string;
  };
}

interface KratosIdentity {
  readonly traits?: { readonly email?: string };
  readonly metadata_public?: unknown;
}

export type IdentityLookup = (subject: string) => Promise<KratosIdentity>;

/** Fetches one identity through the Admin API. Throws on any non-2xx; never echoes the body. */
export const fetchIdentity: IdentityLookup = async (subject) => {
  const base = authConfig.kratosAdminUrl;
  const response = await fetchWithTimeout(
    `${base}/admin/identities/${encodeURIComponent(subject)}`,
    {
      headers: oryAdminHeaders(),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(`Ory rejected the identity lookup: ${response.status}`);
  }
  return (await response.json()) as KratosIdentity;
};

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export async function resolveConsentClaims(
  info: ConsentRequestInfo,
  lookup: IdentityLookup = fetchIdentity,
): Promise<ConsentClaims> {
  const context = info.context;
  if (context?.roles !== undefined) {
    return { kind: context.kind ?? "staff", roles: context.roles, email: context.email };
  }
  if (info.subject === undefined || info.subject.length === 0) {
    throw new Error(
      "The consent request has no subject and no login context — cannot resolve roles.",
    );
  }
  const identity = await lookup(info.subject);
  const meta =
    typeof identity.metadata_public === "object" && identity.metadata_public !== null
      ? (identity.metadata_public as Record<string, unknown>)
      : {};
  return {
    kind: typeof meta["kind"] === "string" ? meta["kind"] : "staff",
    roles: stringArray(meta["roles"]),
    email: identity.traits?.email ?? context?.email,
  };
}
