import type { Principal } from "@platform/contracts";

/** What a resolver sees — transport-shape, framework-free (testable without Fastify). */
export interface TenantResolutionInput {
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly hostname: string;
  readonly principal: Principal | null;
  /** Verified token claims when authentication ran (e.g. a `tenant_id` claim). */
  readonly claims: Readonly<Record<string, unknown>> | null;
}

/** A single strategy; `null` = not resolved, try the next one (ADR-0008 §2). */
export type TenantResolver = (input: TenantResolutionInput) => string | null;

/** `x-tenant-id` header — trusted ONLY for internal/admin surfaces behind authentication. */
export const headerTenantResolver: TenantResolver = (input) =>
  input.headers["x-tenant-id"]?.trim() || null;

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
