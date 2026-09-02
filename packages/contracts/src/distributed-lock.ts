/** A held lock. `release`/`extend` are token-guarded: only the holder's handle succeeds. */
export interface LockHandle {
  readonly key: string;
  /** Random holder token — implementations MUST refuse release/extend with a stale token. */
  readonly token: string;
  /** Returns `false` when the lock had already expired or was taken over. */
  release(): Promise<boolean>;
  /** Extends the TTL; `false` when no longer held. */
  extend(ttlMs: number): Promise<boolean>;
}

/**
 * Outbound port for best-effort distributed locking (D-018, D-044).
 *
 * Contract: locks are an **efficiency** mechanism (avoid duplicate work, serialize hot paths) —
 * NEVER the correctness guard. Correctness stays with optimistic locking + idempotency
 * (ADR-0003/0005): a lock can expire mid-critical-section under GC pause or partition, and a
 * single-instance Redis lock is not fencing-token-safe. Any flow that would corrupt data if two
 * holders overlap must be safe under overlap anyway.
 */
export interface DistributedLock {
  /** Acquires `key` for `ttlMs`, or resolves `null` immediately if held (no queuing). */
  acquire(key: string, ttlMs: number): Promise<LockHandle | null>;
}
