export type HealthStatus = "healthy" | "degraded" | "unhealthy";

/** A single infrastructure dependency probe (database, redis, clickhouse, storage, config). */
export interface HealthCheck {
  readonly name: string;
  /** Performs the probe. Resolves on success; throws/rejects on failure. */
  probe(): Promise<void>;
  /**
   * When `false`, a failure degrades overall status instead of failing it.
   * Defaults to critical (failure ⇒ unhealthy).
   */
  readonly critical?: boolean;
}

export interface ComponentHealth {
  readonly name: string;
  readonly status: HealthStatus;
  readonly durationMs: number;
  readonly error?: string;
}

export interface HealthReport {
  readonly status: HealthStatus;
  readonly checkedAt: string;
  readonly components: readonly ComponentHealth[];
}
