/** Seed for an in-memory definition registry: the definitions belong to exactly one tenant, since
 * the registries are keyed by `(tenantId, id)` like their Prisma siblings (ADR-0014). */
export interface TenantSeed<D> {
  readonly tenantId: string;
  readonly definitions: readonly D[];
}

/** Returns one tenant's own container from a per-tenant `Map`, creating it on first use. Every
 * in-memory store keys its storage through this, so two tenants can never observe each other's rows
 * (the in-memory siblings previously ignored the tenant entirely, which made any isolation test
 * against them vacuous). */
export function bucket<C>(store: Map<string, C>, tenantId: string, make: () => C): C {
  let existing = store.get(tenantId);
  if (existing === undefined) {
    existing = make();
    store.set(tenantId, existing);
  }
  return existing;
}
