/**
 * One lazily-built runtime per tenant (G-64).
 *
 * The tracking ingest consumer used to load one tenant's registry at boot and route every tenant's
 * events through it. Under `TENANT_MODE=multi` the registry (destinations, mappings, rule sets) is
 * per tenant, so the consumer needs a registry — and its hot-reload watcher — per tenant, and the
 * only source of "which tenant" is the message's envelope. Building on first use is what lets the
 * worker serve a tenant it was not told about at boot.
 *
 * Properties this class exists to guarantee, each pinned by `tracking-ingest-tenant.test.ts`:
 *  - a tenant's runtime is built once and never shared with another tenant;
 *  - concurrent first events for one tenant share a single load (no double watcher);
 *  - a FAILED load is not cached, so the runtime's retry re-attempts it rather than replaying a
 *    poisoned promise forever;
 *  - there is no default: an empty tenant id is refused, never mapped to one.
 *
 * Runtimes are kept for the process lifetime (one per tenant that has produced an event).
 */
export interface TenantRuntimeHandle<R> {
  readonly runtime: R;
  /** Releases what the runtime holds (e.g. a hot-reload timer). */
  stop(): void | Promise<void>;
}

export class TenantRuntimes<R> {
  private readonly built = new Map<string, Promise<TenantRuntimeHandle<R>>>();

  constructor(private readonly load: (tenantId: string) => Promise<TenantRuntimeHandle<R>>) {}

  async for(tenantId: string): Promise<R> {
    if (tenantId.trim() === "") {
      throw new Error("TenantRuntimes: a tenant id is required — refusing to default one (G-64)");
    }
    let pending = this.built.get(tenantId);
    if (pending === undefined) {
      const attempt = this.load(tenantId);
      pending = attempt;
      this.built.set(tenantId, attempt);
      attempt.catch(() => {
        if (this.built.get(tenantId) === attempt) this.built.delete(tenantId);
      });
    }
    return (await pending).runtime;
  }

  async stopAll(): Promise<void> {
    const handles = [...this.built.values()];
    this.built.clear();
    for (const handle of handles) {
      const settled = await handle.then(
        (h) => h,
        () => null,
      );
      await settled?.stop();
    }
  }
}
