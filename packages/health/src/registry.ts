import { toSerializableError } from "@platform/utils";
import type { ComponentHealth, HealthCheck, HealthReport, HealthStatus } from "./types";

/**
 * Bound on a single probe (Phase 9 hardening). Before this, `runOne` awaited `check.probe()`
 * directly with no timeout — a probe that hangs (a JWKS fetch against an unreachable issuer, a
 * stalled DB connection) hung `run()` forever, since it's a plain `Promise.all` over every check.
 * `/readyz` would then never respond, not even with 503 — worse than reporting unhealthy, because
 * an orchestrator reading a hung readiness probe often behaves differently (and worse) than one
 * reading a fast, honest failure.
 */
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/** Registers infrastructure health checks and runs them into a composite report. */
export class HealthRegistry {
  private readonly checks: HealthCheck[] = [];

  register(check: HealthCheck): this {
    this.checks.push(check);
    return this;
  }

  registerAll(checks: readonly HealthCheck[]): this {
    for (const check of checks) this.checks.push(check);
    return this;
  }

  async run(): Promise<HealthReport> {
    const components = await Promise.all(this.checks.map((check) => this.runOne(check)));
    return {
      status: aggregate(components),
      checkedAt: new Date().toISOString(),
      components,
    };
  }

  private async runOne(check: HealthCheck): Promise<ComponentHealth> {
    const start = Date.now();
    try {
      await withTimeout(check.probe(), DEFAULT_PROBE_TIMEOUT_MS, check.name);
      return { name: check.name, status: "healthy", durationMs: Date.now() - start };
    } catch (error) {
      const status: HealthStatus = check.critical === false ? "degraded" : "unhealthy";
      return {
        name: check.name,
        status,
        durationMs: Date.now() - start,
        error: toSerializableError(error).message,
      };
    }
  }
}

function withTimeout<T>(probe: Promise<T>, timeoutMs: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`probe "${name}" timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([probe, timeout]).finally(() => clearTimeout(timer));
}

function aggregate(components: readonly ComponentHealth[]): HealthStatus {
  if (components.some((component) => component.status === "unhealthy")) return "unhealthy";
  if (components.some((component) => component.status === "degraded")) return "degraded";
  return "healthy";
}

/** Maps a report to an HTTP-friendly shape (503 when unhealthy, otherwise 200). */
export function healthReportToHttp(report: HealthReport): { status: number; body: HealthReport } {
  return { status: report.status === "unhealthy" ? 503 : 200, body: report };
}
