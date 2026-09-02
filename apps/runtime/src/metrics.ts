import type { HealthReport } from "@platform/health";
import type { MessagingMetrics } from "@platform/kafka";

/**
 * Lightweight, dependency-free runtime metrics (F5 / G-19). Hand-rolled Prometheus text — no
 * SDK, no OTel, no `prom-client`. Metrics are isolated here and at the composition/entrypoint
 * layer; no application, domain, or business code is touched. Two consumption shapes:
 *  - `MessagingMetrics` (implemented) — passed to the Kafka consumer runtime (Worker);
 *  - `HttpMetricsSink` (structural) — the additive-optional port the HTTP transport calls;
 * plus process metrics, dependency-up gauges (from the last readiness report) and a liveness gauge.
 */

type Labels = Readonly<Record<string, string>>;

function labelKey(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${JSON.stringify(labels[k])}`).join(",");
}

function renderMetric(
  name: string,
  type: "counter" | "gauge",
  help: string,
  series: ReadonlyMap<string, number>,
): string {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`];
  if (series.size === 0) {
    lines.push(`${name} 0`);
  } else {
    for (const [key, value] of series) {
      lines.push(key.length > 0 ? `${name}{${key}} ${value}` : `${name} ${value}`);
    }
  }
  return lines.join("\n");
}

class Metric {
  readonly series = new Map<string, number>();
  add(labels: Labels, delta: number): void {
    const key = labelKey(labels);
    this.series.set(key, (this.series.get(key) ?? 0) + delta);
  }
  set(labels: Labels, value: number): void {
    this.series.set(labelKey(labels), value);
  }
}

export class RuntimeMetrics implements MessagingMetrics {
  private readonly startedAt = Date.now();

  // Messaging (Worker) — counters + processing-duration accumulator.
  private readonly msgProcessed = new Metric();
  private readonly msgFailed = new Metric();
  private readonly msgRetried = new Metric();
  private readonly msgDeadLettered = new Metric();
  private readonly msgDuplicate = new Metric();
  private readonly msgDurationSum = new Metric();

  // HTTP (API) — request counter + duration accumulator.
  private readonly httpRequests = new Metric();
  private readonly httpDurationSum = new Metric();

  // Dependency health gauges (from the last readiness report) + liveness.
  private readonly dependencyUp = new Metric();
  private readonly ready = new Metric();

  // CDC watchdog (Phase A.23) — observable recovery status per Task 3's "expose observable
  // recovery status" requirement.
  private readonly cdcTaskFailed = new Metric();
  private readonly cdcWatchdogRestarts = new Metric();
  private readonly cdcWatchdogRestartsSkipped = new Metric();

  // Outbox relay (C-8) — the polling publisher that replaces Debezium CDC where Docker/Kafka
  // Connect is unavailable.
  private readonly outboxPublished = new Metric();
  private readonly outboxRelayFailures = new Metric();

  // ---- MessagingMetrics (called by KafkaConsumerRuntime) ----
  processed(topic: string, consumerGroup: string, durationMs: number): void {
    const l = { topic, group: consumerGroup };
    this.msgProcessed.add(l, 1);
    this.msgDurationSum.add(l, durationMs);
  }
  failed(topic: string, consumerGroup: string): void {
    this.msgFailed.add({ topic, group: consumerGroup }, 1);
  }
  retried(topic: string, consumerGroup: string): void {
    this.msgRetried.add({ topic, group: consumerGroup }, 1);
  }
  deadLettered(topic: string, consumerGroup: string): void {
    this.msgDeadLettered.add({ topic, group: consumerGroup }, 1);
  }
  duplicate(topic: string, consumerGroup: string): void {
    this.msgDuplicate.add({ topic, group: consumerGroup }, 1);
  }

  // ---- HttpMetricsSink (called by @platform/http onResponse) ----
  recordHttp(method: string, status: number, durationMs: number): void {
    const l = { method, status: String(status) };
    this.httpRequests.add(l, 1);
    this.httpDurationSum.add(l, durationMs);
  }

  /** CDC watchdog (Phase A.23): reflects the last-observed Kafka Connect task state. */
  recordCdcTaskState(connector: string, task: string, failed: boolean): void {
    this.cdcTaskFailed.set({ connector, task }, failed ? 1 : 0);
  }
  /** CDC watchdog: a restart was actually issued (task was FAILED and under the restart cap). */
  recordCdcWatchdogRestart(connector: string, task: string): void {
    this.cdcWatchdogRestarts.add({ connector, task }, 1);
  }
  /** CDC watchdog (Task 4 Case D): a restart was withheld because the per-window cap was hit. */
  recordCdcWatchdogRestartSkipped(connector: string, task: string): void {
    this.cdcWatchdogRestartsSkipped.add({ connector, task }, 1);
  }

  /** C-8: total outbox rows published by the polling relay. */
  recordOutboxPublished(count: number): void {
    this.outboxPublished.add({}, count);
  }
  /** C-8: relay ticks that threw. Alert on any sustained non-zero rate — it means events are stuck. */
  recordOutboxRelayFailure(): void {
    this.outboxRelayFailures.add({}, 1);
  }

  /** Reflect the last readiness report as `runtime_dependency_up` gauges + `runtime_ready`. */
  updateHealth(report: HealthReport): void {
    for (const c of report.components) {
      this.dependencyUp.set({ name: c.name }, c.status === "healthy" ? 1 : 0);
    }
    this.ready.set({}, report.status === "unhealthy" ? 0 : 1);
  }

  private processMetrics(): string {
    const mem = process.memoryUsage();
    return [
      renderMetric(
        "process_uptime_seconds",
        "gauge",
        "Process uptime in seconds.",
        new Map([["", (Date.now() - this.startedAt) / 1000]]),
      ),
      renderMetric(
        "process_resident_memory_bytes",
        "gauge",
        "Resident memory size in bytes.",
        new Map([["", mem.rss]]),
      ),
      renderMetric(
        "nodejs_heap_used_bytes",
        "gauge",
        "V8 heap used in bytes.",
        new Map([["", mem.heapUsed]]),
      ),
      renderMetric(
        "nodejs_heap_total_bytes",
        "gauge",
        "V8 heap total in bytes.",
        new Map([["", mem.heapTotal]]),
      ),
      renderMetric("runtime_up", "gauge", "1 while the process is serving.", new Map([["", 1]])),
    ].join("\n");
  }

  /**
   * HTTP-tier metrics (appended to the API's existing process `/metrics`). H2-7: previously omitted
   * `runtime_ready`/`runtime_dependency_up` — the API's `/readyz` never called `updateHealth`
   * (fixed in `@platform/http`'s `/readyz` handler) and even once it did, this method didn't render
   * them, so the two gauges the worker/scheduler already expose stayed absent from the tier that
   * serves customer traffic. Messaging gauges stay out (the API is not a Kafka consumer).
   */
  renderHttp(): string {
    return [
      renderMetric(
        "http_requests_total",
        "counter",
        "HTTP requests handled, by method and status.",
        this.httpRequests.series,
      ),
      renderMetric(
        "http_request_duration_ms_sum",
        "counter",
        "Cumulative HTTP handling time in ms, by method and status.",
        this.httpDurationSum.series,
      ),
      renderMetric(
        "runtime_ready",
        "gauge",
        "1 when the last readiness report was healthy/degraded, 0 when unhealthy.",
        this.ready.series,
      ),
      renderMetric(
        "runtime_dependency_up",
        "gauge",
        "1 when a dependency was healthy at the last readiness check, else 0.",
        this.dependencyUp.series,
      ),
    ].join("\n");
  }

  /** Full exposition (Worker/Scheduler `/metrics`): process + dependency + messaging (+ http). */
  render(): string {
    const blocks = [
      this.processMetrics(),
      renderMetric(
        "runtime_ready",
        "gauge",
        "1 when the last readiness report was healthy/degraded, 0 when unhealthy.",
        this.ready.series,
      ),
      renderMetric(
        "runtime_dependency_up",
        "gauge",
        "1 when a dependency was healthy at the last readiness check, else 0.",
        this.dependencyUp.series,
      ),
      renderMetric(
        "messaging_messages_processed_total",
        "counter",
        "Messages processed, by topic and consumer group.",
        this.msgProcessed.series,
      ),
      renderMetric(
        "messaging_messages_failed_total",
        "counter",
        "Message handler failures, by topic and consumer group.",
        this.msgFailed.series,
      ),
      renderMetric(
        "messaging_messages_retried_total",
        "counter",
        "Messages scheduled for retry, by topic and consumer group.",
        this.msgRetried.series,
      ),
      renderMetric(
        "messaging_messages_dead_lettered_total",
        "counter",
        "Messages dead-lettered, by topic and consumer group.",
        this.msgDeadLettered.series,
      ),
      renderMetric(
        "messaging_messages_duplicate_total",
        "counter",
        "Duplicate messages skipped by the inbox, by topic and consumer group.",
        this.msgDuplicate.series,
      ),
      renderMetric(
        "messaging_process_duration_ms_sum",
        "counter",
        "Cumulative message processing time in ms, by topic and consumer group.",
        this.msgDurationSum.series,
      ),
      renderMetric(
        "cdc_connector_task_failed",
        "gauge",
        "1 when the CDC watchdog last observed this connector task in a FAILED state, else 0.",
        this.cdcTaskFailed.series,
      ),
      renderMetric(
        "cdc_watchdog_restarts_total",
        "counter",
        "CDC watchdog task restarts issued, by connector and task.",
        this.cdcWatchdogRestarts.series,
      ),
      renderMetric(
        "cdc_watchdog_restarts_skipped_total",
        "counter",
        "CDC watchdog restarts withheld because the per-window restart cap was reached (Task 4 Case D).",
        this.cdcWatchdogRestartsSkipped.series,
      ),
      renderMetric(
        "outbox_relay_published_total",
        "counter",
        "Outbox rows published by the polling relay (C-8).",
        this.outboxPublished.series,
      ),
      renderMetric(
        "outbox_relay_failures_total",
        "counter",
        "Outbox relay ticks that threw (C-8). Alert on any sustained non-zero rate.",
        this.outboxRelayFailures.series,
      ),
    ];
    return `${blocks.join("\n")}\n`;
  }
}
