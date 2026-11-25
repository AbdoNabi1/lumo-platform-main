import type { StaffMutationLock } from "../domain/repositories";

/** In-memory twin of the Postgres advisory lock: a real per-tenant queued mutex around `fn`. `tx` is ignored. */
export class InMemoryStaffMutationLock implements StaffMutationLock {
  private readonly tails = new Map<string, Promise<void>>();

  async withTenantStaffLock<T>(tenantId: string, _tx: unknown, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(tenantId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(tenantId, current);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(tenantId) === current) this.tails.delete(tenantId);
    }
  }
}
