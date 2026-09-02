import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RuntimeMetrics } from "./metrics";

/**
 * Guards the invariant investigation H-04 found broken: the Prometheus SLO/alert rules queried
 * metric names the runtime never emitted, so `sli:api_availability:ratio5m` evaluated to a constant
 * `1` (perfectly available) and no burn-rate or readiness alert could ever fire.
 *
 * These tests read the ACTUAL rule files rather than a copy of their metric list, so a rule that
 * starts querying a new series fails here instead of silently producing an alert that never fires.
 */

const RULES_DIR = join(
  __dirname,
  "..",
  "..",
  "..",
  "infrastructure",
  "docker",
  "prometheus",
  "rules",
);

function rulesText(): string {
  return [
    readFileSync(join(RULES_DIR, "slo.recording.rules.yml"), "utf8"),
    readFileSync(join(RULES_DIR, "alerts.rules.yml"), "utf8"),
  ].join("\n");
}

/**
 * Metrics the rules reference that this process deliberately does NOT emit, each with the reason.
 * `up` is synthesised by Prometheus itself; the two security series come from the OTel security
 * telemetry, which the rule file itself annotates as conditional ("Absent metric → no alert, which
 * is correct here") and which investigation H-02 records as unreachable until the zero-trust runtime
 * is mounted. Anything else the rules query must be produced by `RuntimeMetrics`.
 */
const NOT_EMITTED_BY_RUNTIME = new Set(["up", "failed_logins", "authorization_latency_bucket"]);

/** Base series the rules query, excluding recording-rule outputs (which always contain a colon). */
function referencedBaseMetrics(text: string): string[] {
  const matches = text.matchAll(/(?<![:\w])([a-z_][a-z0-9_]{4,})(?=\{|\s*[=<>!]|\)|\s*\[)/g);
  const reserved = new Set([
    "ratio",
    "budget",
    "anchor",
    "component",
    "status",
    "ticket",
    "available",
    "requests",
    "unhealthy",
    "_total",
    "messaging_messages_",
  ]);
  return [...new Set([...matches].map((m) => m[1] ?? ""))].filter(
    (name) => name.length > 0 && !reserved.has(name) && !NOT_EMITTED_BY_RUNTIME.has(name),
  );
}

describe("RuntimeMetrics exposition", () => {
  it("emits every base metric the SLO recording rules and alert rules query", () => {
    const metrics = new RuntimeMetrics();
    const exposition = `${metrics.render()}\n${metrics.renderHttp()}`;

    for (const name of referencedBaseMetrics(rulesText())) {
      expect(exposition, `rules query "${name}" but the runtime never emits it`).toContain(name);
    }
  });

  it("emits zero-valued series before any traffic, so a rule never sees an absent selector", () => {
    // The H-04 failure mode was silence, not wrong numbers: with no series at all,
    // `1 - (errors / clamp_min(requests, 1))` reads as perfectly available forever.
    const exposition = new RuntimeMetrics().render();
    expect(exposition).toContain("messaging_messages_processed_total 0");
    expect(exposition).toContain("messaging_messages_dead_lettered_total 0");
  });

  it("counts messaging outcomes by topic and consumer group", () => {
    const metrics = new RuntimeMetrics();
    metrics.processed("orders.paid.v1", "orders.payment-captured", 12);
    metrics.processed("orders.paid.v1", "orders.payment-captured", 8);
    metrics.failed("orders.paid.v1", "orders.payment-captured");
    metrics.deadLettered("orders.paid.v1", "orders.payment-captured");
    metrics.duplicate("orders.paid.v1", "orders.payment-captured");

    const out = metrics.render();
    const labels = `{group="orders.payment-captured",topic="orders.paid.v1"}`;
    expect(out).toContain(`messaging_messages_processed_total${labels} 2`);
    expect(out).toContain(`messaging_messages_failed_total${labels} 1`);
    expect(out).toContain(`messaging_messages_dead_lettered_total${labels} 1`);
    expect(out).toContain(`messaging_messages_duplicate_total${labels} 1`);
    expect(out).toContain(`messaging_process_duration_ms_sum${labels} 20`);
  });

  it("counts HTTP responses by method and status, which is what the availability SLI divides", () => {
    const metrics = new RuntimeMetrics();
    metrics.recordHttp("GET", 200, 5);
    metrics.recordHttp("GET", 200, 7);
    metrics.recordHttp("POST", 500, 30);

    const out = metrics.renderHttp();
    expect(out).toContain(`http_requests_total{method="GET",status="200"} 2`);
    expect(out).toContain(`http_requests_total{method="POST",status="500"} 1`);
    expect(out).toContain(`http_request_duration_ms_sum{method="GET",status="200"} 12`);
  });

  it("H2-7: renderHttp() (the API's /metrics) also carries runtime_ready/runtime_dependency_up, not just render() (worker/scheduler)", () => {
    const metrics = new RuntimeMetrics();
    metrics.updateHealth({
      status: "healthy",
      checkedAt: new Date(0).toISOString(),
      components: [{ name: "postgres", status: "healthy", durationMs: 2 }],
    });

    const out = metrics.renderHttp();
    expect(out).toContain("runtime_ready 1");
    expect(out).toContain(`runtime_dependency_up{name="postgres"} 1`);
  });

  it("reflects the readiness report as runtime_ready and per-dependency gauges", () => {
    const metrics = new RuntimeMetrics();
    metrics.updateHealth({
      status: "unhealthy",
      checkedAt: new Date(0).toISOString(),
      components: [
        { name: "postgres", status: "healthy", durationMs: 3 },
        { name: "redis", status: "unhealthy", durationMs: 51 },
      ],
    });

    const out = metrics.render();
    expect(out).toContain("runtime_ready 0"); // drives the RuntimeNotReady alert
    expect(out).toContain(`runtime_dependency_up{name="postgres"} 1`);
    expect(out).toContain(`runtime_dependency_up{name="redis"} 0`); // drives DependencyDown
  });
});
