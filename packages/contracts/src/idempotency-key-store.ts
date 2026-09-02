/**
 * Outbound port for client-request idempotency keys (`Idempotency-Key` header, doc 04 §2) —
 * distinct from consumer-event idempotency (`ProcessedEventStore`, ADR-0005: Postgres, in the
 * handler's transaction). This one is a short-TTL claim: the first request claims the key and
 * executes; concurrent duplicates are rejected as in-flight; a failed execution releases the
 * claim so the client can retry. Response replay (returning the first outcome to duplicates)
 * layers on top via the `Cache` port keyed by the same key.
 *
 * Contract: `claim` MUST be atomic (single compare-and-set); `release` MUST be token-guarded so
 * a slow failure cannot release a successor's claim. Keys MUST be tenant-scoped (ADR-0008).
 */
export interface IdempotencyClaim {
  readonly key: string;
  readonly token: string;
  /** Releases a claim after a FAILED execution (token-guarded); successful ones expire via TTL. */
  release(): Promise<boolean>;
}

export interface IdempotencyKeyStore {
  /** Claims `key` for `ttlSeconds`; `null` when already claimed (duplicate in flight/completed). */
  claim(key: string, ttlSeconds: number): Promise<IdempotencyClaim | null>;
}
