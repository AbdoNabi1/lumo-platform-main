/**
 * Generic resilience primitives for the Security context's **live provider adapters** (H-3 / G-SEC-2):
 * timeout protection, bounded retry with backoff, a circuit breaker, and a TTL cache. They are pure
 * infrastructure — no provider-specific logic — so every KMS / HSM / threat-intel adapter composes the
 * same failure discipline instead of re-implementing it (cross-cutting no-duplication rule). Errors are
 * always explicit: nothing is swallowed silently; a tripped breaker or a timeout throws a typed error the
 * caller decides on (fan-out isolates it; a single hot call surfaces it).
 */

/** Thrown when an operation exceeds its deadline. */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`operation '${label}' timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/** Thrown when a circuit breaker is open and short-circuits the call. */
export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`circuit '${name}' is open`);
    this.name = "CircuitOpenError";
  }
}

/**
 * Runs `op` but rejects with {@link TimeoutError} if it does not settle within `ms`. The timer is always
 * cleared (success, failure, or timeout) so no handle leaks. `op` keeps running in the background on
 * timeout — provider adapters treat a timed-out response as a failure, never a partial result.
 */
export async function withTimeout<T>(op: () => Promise<T>, ms: number, label: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return op();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  try {
    return await Promise.race([op(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface RetryOptions {
  /** Total attempts including the first (default 3). */
  readonly attempts?: number;
  /** Base backoff in ms; delay = base * 2^(n-1) (default 50). */
  readonly baseDelayMs?: number;
  /** Optional sleeper (injected in tests to avoid real timers). */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Predicate deciding whether an error is retryable (default: always). */
  readonly retryable?: (error: unknown) => boolean;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retries `op` with exponential backoff up to `attempts` times, re-throwing the last error when
 * exhausted (never a swallowed failure). A non-retryable error (per `retryable`) fails fast.
 */
export async function retry<T>(op: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 50;
  const sleep = options.sleep ?? defaultSleep;
  const retryable = options.retryable ?? ((): boolean => true);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await op();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !retryable(error)) break;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

export interface CircuitBreakerOptions {
  readonly name: string;
  /** Consecutive failures before the circuit opens (default 5). */
  readonly failureThreshold?: number;
  /** How long the circuit stays open before a half-open trial (default 30s). */
  readonly cooldownMs?: number;
  /** Injected clock (tests) — defaults to `Date.now`. */
  readonly now?: () => number;
}

type BreakerState = "closed" | "open" | "half-open";

/**
 * A classic three-state circuit breaker (`closed` → `open` → `half-open`). After `failureThreshold`
 * consecutive failures it opens and short-circuits calls with {@link CircuitOpenError} until `cooldownMs`
 * elapses, then admits a single half-open trial: success closes it, failure re-opens it. It shields an
 * upstream provider (and the caller) from hammering a dead dependency, and it makes failure observable.
 */
export class CircuitBreaker {
  private state: BreakerState = "closed";
  private failures = 0;
  private openedAt = 0;
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 5);
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  /** Current breaker state (for tests/telemetry). */
  get status(): BreakerState {
    return this.snapshotState();
  }

  private snapshotState(): BreakerState {
    if (this.state === "open" && this.now() - this.openedAt >= this.cooldownMs) return "half-open";
    return this.state;
  }

  async exec<T>(op: () => Promise<T>): Promise<T> {
    const effective = this.snapshotState();
    if (effective === "open") throw new CircuitOpenError(this.name);
    if (effective === "half-open") this.state = "half-open";
    try {
      const result = await op();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  private onFailure(): void {
    this.failures += 1;
    if (this.state === "half-open" || this.failures >= this.failureThreshold) {
      this.state = "open";
      this.openedAt = this.now();
    }
  }
}

interface CacheEntry<V> {
  readonly value: V;
  readonly expiresAt: number;
}

/**
 * A minimal TTL cache — fresh entries are served without hitting the upstream provider (bounding cost and
 * rate-limit exposure), stale entries are evicted lazily on read. `now` is injectable for deterministic
 * tests. No background timer, so it never keeps the process alive.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, CacheEntry<V>>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(ttlMs: number, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  /** Explicit invalidation of a single key (event-driven cache busting). */
  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Drops every entry (e.g. on a version bump / bulk invalidation). */
  clear(): void {
    this.entries.clear();
  }

  /** Current live (non-expired) entry count — for cache-size metrics/tests. */
  get size(): number {
    const now = this.now();
    let live = 0;
    for (const entry of this.entries.values()) if (now < entry.expiresAt) live += 1;
    return live;
  }
}
