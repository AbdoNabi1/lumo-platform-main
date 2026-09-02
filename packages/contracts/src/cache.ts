/**
 * Outbound port for a key/value cache (D-018). Values must survive JSON round-trips — cache
 * **row/DTO shapes, never live aggregates**; rehydrate through the owning context's mapper so
 * domain invariants are re-established on read (D-044). Keys are caller-namespaced and MUST be
 * tenant-prefixed for tenant-scoped data (ADR-0008 §2). A cache is an availability optimization:
 * callers must treat every read as a maybe (`null` ⇒ go to the source of truth), and deletion is
 * the only safe invalidation under transactions (delete-then-miss beats stale-forever).
 */
export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}
