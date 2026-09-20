import type { AuthenticatedIdentity } from "@platform/contracts";

/** What a resolver sees — transport-shape, framework-free (testable without Fastify). */
export interface TenantResolutionInput {
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly hostname: string;
  readonly principal: AuthenticatedIdentity | null;
  /** Verified token claims when authentication ran (e.g. a `tenant_id` claim). */
  readonly claims: Readonly<Record<string, unknown>> | null;
}

/** A single strategy; `null` = not resolved, try the next one (ADR-0008 §2). */
export type TenantResolver = (input: TenantResolutionInput) => string | null;

/**
 * `x-tenant-id` header. Trusts the caller outright — use it only where the deployment is locked to
 * one tenant (`TENANT_MODE=single`, `singleTenantGuardedResolver`). Under multi, use
 * {@link publicHeaderTenantResolver}: this one lets any authenticated caller name any tenant.
 */
export const headerTenantResolver: TenantResolver = (input) =>
  input.headers["x-tenant-id"]?.trim() || null;

/** The fixed identity a `public` route runs as: no verified principal, nothing to protect. */
export const PUBLIC_PRINCIPAL_ID = "public";

/**
 * `x-tenant-id` for an UNAUTHENTICATED request only (T10.5). The header is client-controlled, so it
 * is honoured solely where there is no verified identity — public storefront routes, where the
 * tenant IS the request. For an authenticated principal it resolves to `null` (never to the
 * header): a token that lacks a `tenant_id` claim is bound to no tenant, and must not be allowed to
 * name one — otherwise any valid token could act inside any tenant by asserting its id.
 */
export const publicHeaderTenantResolver: TenantResolver = (input) =>
  input.principal === null || input.principal.id === PUBLIC_PRINCIPAL_ID
    ? headerTenantResolver(input)
    : null;

/** Tenant claim from the verified token (the default for app/API traffic, doc 24 §3). */
export const claimTenantResolver: TenantResolver = (input) => {
  const claim = input.claims?.["tenant_id"];
  return typeof claim === "string" && claim.length > 0 ? claim : null;
};

/** Custom-domain / subdomain mapping (storefront traffic, doc 25 §3). */
export function domainTenantResolver(
  domainToTenant: (hostname: string) => string | null,
): TenantResolver {
  return (input) => domainToTenant(input.hostname);
}

/**
 * Runs the resolver chain in order; the FIRST hit wins. Returning `null` means the request has
 * no tenant — the server rejects it before any application code runs (tenant-resolution-first
 * rule, ADR-0008/doc 25 §4). Deliberately no default tenant: an unresolved tenant is an error,
 * never a fallback.
 */
export function resolveTenant(
  resolvers: readonly TenantResolver[],
  input: TenantResolutionInput,
): string | null {
  for (const resolver of resolvers) {
    const tenantId = resolver(input);
    if (tenantId !== null) return tenantId;
  }
  return null;
}
