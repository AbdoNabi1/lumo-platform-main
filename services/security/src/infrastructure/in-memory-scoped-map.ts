/**
 * ADR-0014 (WP-10, T10.3): every in-memory index is partitioned by `tenantId`, so two tenants that
 * reuse a key (role key, principal external id, fingerprint …) never see each other's rows — the same
 * isolation the Prisma repositories get from `WHERE tenant_id` + RLS.
 */
export class ScopedMap<V> {
  private readonly byTenant = new Map<string, Map<string, V>>();
  private bucket(tenantId: string): Map<string, V> {
    let b = this.byTenant.get(tenantId);
    if (b === undefined) {
      b = new Map();
      this.byTenant.set(tenantId, b);
    }
    return b;
  }
  set(tenantId: string, key: string, value: V): void {
    this.bucket(tenantId).set(key, value);
  }
  get(tenantId: string, key: string): V | undefined {
    return this.byTenant.get(tenantId)?.get(key);
  }
  delete(tenantId: string, key: string): boolean {
    return this.byTenant.get(tenantId)?.delete(key) ?? false;
  }
  values(tenantId: string): V[] {
    return [...(this.byTenant.get(tenantId)?.values() ?? [])];
  }
}
