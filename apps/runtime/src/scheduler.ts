import type { Clock } from "@platform/contracts";
import { logger, type Logger } from "@platform/utils";
import { loadRuntimeConfig, type RuntimeConfig } from "./config";
import { buildRuntimeCore, type RuntimeCore } from "./composition";
import { startHealthServer } from "./health-server";
import type { RuntimeMetrics } from "./metrics";
import { startRuntimeTelemetry } from "./telemetry";

export interface ScheduledJob {
  readonly name: string;
  readonly intervalMs: number;
  run(): Promise<void>;
}

/**
 * Scheduler entrypoint (Sprint 2.9): a deliberately boring interval-based job runner — jobs are
 * injected, single-flight per job, failures logged and retried next tick (jobs must be
 * idempotent). Cron-expression scheduling and Temporal Schedules replace the interval loop when
 * the runtime host lands (doc 26 §7) — the JOB CONTRACT is what matters and it stays.
 *
 * Jobs today: outbox pruning (the outbox is a queue, not an event store — OutboxStore port
 * contract). Reservation expiry joins when ADR-0013's ledger lands (`expire` appends);
 * DLQ replay tooling joins with the ops sprint. Distributed locking (Redis, Sprint 2.3) guards
 * multi-instance schedulers.
 */
/**
 * CDC watchdog (Phase A.23, Task 3). A.22 reproduced and characterized the one real CDC gap this
 * codebase has: a PostgreSQL outage long enough to exhaust Debezium's internal retry budget
 * (`errors.max.retries`/`errors.retry.delay.max.ms` in `outbox-connector.json`) leaves the Kafka
 * Connect task permanently `FAILED` — no container healthcheck or k8s probe can see it (both hit
 * `GET /connectors`, which returns 200 regardless of task health), and nothing restarts it. The
 * fix A.22 proved works, every time: `POST /connectors/<name>/tasks/<id>/restart`. This is that
 * call, on a timer, with a restart-loop guard — no new distributed system, no framework swap, the
 * exact existing Kafka Connect REST API `infrastructure/docker/debezium/register-connector.sh` and
 * `infrastructure/k8s/70-debezium.yaml`'s registration Job already use.
 */
interface ConnectTaskStatus {
  readonly id: number;
  readonly state: string;
}
interface ConnectStatus {
  readonly name: string;
  readonly connector: { readonly state: string };
  readonly tasks: readonly ConnectTaskStatus[];
}

/** Per-connector-task restart history, kept in-process for the lifetime of the scheduler. */
export interface CdcWatchdogState {
  readonly restarts: Map<string, number[]>;
}
export function createCdcWatchdogState(): CdcWatchdogState {
  return { restarts: new Map() };
}

export interface CdcWatchdogDeps {
  readonly connectUrl: string;
  readonly connectors: readonly string[];
  readonly maxRestarts: number;
  readonly restartWindowMs: number;
  readonly state: CdcWatchdogState;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly metrics: Pick<
    RuntimeMetrics,
    "recordCdcTaskState" | "recordCdcWatchdogRestart" | "recordCdcWatchdogRestartSkipped"
  >;
  readonly fetchImpl: typeof fetch;
}

/**
 * Polls every configured connector's task status and restarts any task found `FAILED`, bounded by
 * a rolling-window restart cap (Task 4 Case D: never create an infinite restart loop — a task that
 * fails immediately on every restart attempt, e.g. a genuinely broken connector config rather than
 * a transient outage, must stop being retried and instead surface as an observable, alertable
 * condition via `cdc_watchdog_restarts_skipped_total`/logs, not spin forever).
 *
 * Only `FAILED` triggers a restart (Task 4 Case A/B): `RUNNING`/`PAUSED`/`UNASSIGNED` and any other
 * transient Kafka Connect task state are left alone, so a connector recovering on its own (A.22 §4a
 * — a graceful restart self-heals within Debezium's own retry budget) is never interfered with.
 * Each connector's tasks are evaluated independently (Task 4 Case G): a FAILED task on one
 * connector never touches a healthy task on another.
 */
export async function runCdcWatchdog(deps: CdcWatchdogDeps): Promise<void> {
  for (const connector of deps.connectors) {
    let status: ConnectStatus;
    try {
      const res = await deps.fetchImpl(`${deps.connectUrl}/connectors/${connector}/status`);
      if (!res.ok) {
        deps.logger.warn("cdc watchdog: status check failed", {
          connector,
          httpStatus: res.status,
        });
        continue;
      }
      status = (await res.json()) as ConnectStatus;
    } catch (error) {
      deps.logger.warn("cdc watchdog: status check errored", { connector, error: String(error) });
      continue;
    }

    for (const task of status.tasks) {
      const taskId = String(task.id);
      const failed = task.state === "FAILED";
      deps.metrics.recordCdcTaskState(connector, taskId, failed);
      if (!failed) continue;

      const key = `${connector}/${taskId}`;
      const now = deps.clock.now().getTime();
      const windowStart = now - deps.restartWindowMs;
      const history = (deps.state.restarts.get(key) ?? []).filter((t) => t > windowStart);

      if (history.length >= deps.maxRestarts) {
        deps.state.restarts.set(key, history);
        deps.metrics.recordCdcWatchdogRestartSkipped(connector, taskId);
        deps.logger.error("cdc watchdog: restart cap reached, leaving task FAILED", {
          connector,
          task: taskId,
          restartsInWindow: history.length,
          maxRestarts: deps.maxRestarts,
        });
        continue;
      }

      try {
        const restartRes = await deps.fetchImpl(
          `${deps.connectUrl}/connectors/${connector}/tasks/${taskId}/restart`,
          { method: "POST" },
        );
        if (restartRes.ok || restartRes.status === 204) {
          history.push(now);
          deps.state.restarts.set(key, history);
          deps.metrics.recordCdcWatchdogRestart(connector, taskId);
          deps.logger.warn("cdc watchdog: restarted FAILED task", { connector, task: taskId });
        } else {
          deps.logger.error("cdc watchdog: restart call failed", {
            connector,
            task: taskId,
            httpStatus: restartRes.status,
          });
        }
      } catch (error) {
        deps.logger.error("cdc watchdog: restart call errored", {
          connector,
          task: taskId,
          error: String(error),
        });
      }
    }
  }
}

export function buildJobs(core: RuntimeCore): readonly ScheduledJob[] {
  const cdcWatchdogState = createCdcWatchdogState();

  return [
    {
      name: "outbox-prune",
      intervalMs: 60 * 60 * 1000,
      run: async () => {
        const cutoff = new Date(
          core.clock.now().getTime() - core.config.OUTBOX_RETENTION_DAYS * 24 * 60 * 60 * 1000,
        );

        // C-8: with the polling relay running, `markPublished` sets status='published' on every
        // delivered row, so publication is directly observable and pruning can be conditional on
        // it — restoring the original OutboxStore contract. This branch replaces the CDC-specific
        // accounting below entirely (that logic assumes status never leaves "pending", which is
        // false once the relay is on) and returns before the pg_replication_slots gate, which
        // applies only to Debezium/CDC mode — that slot does not exist in relay mode.
        if (core.config.OUTBOX_RELAY_ENABLED) {
          const result = await core.prisma.outboxEntry.deleteMany({
            where: { status: "published", createdAt: { lt: cutoff } },
          });
          const stuck = await core.prisma.outboxEntry.count({
            where: { status: "pending", createdAt: { lt: cutoff } },
          });
          if (stuck > 0) {
            core.logger.error("outbox rows past retention are still unpublished", {
              count: stuck,
              retentionDays: core.config.OUTBOX_RETENTION_DAYS,
            });
          }
          core.logger.info("outbox pruned", { deleted: result.count });
          return;
        }

        // C2-3: production publishing is Debezium/CDC (OutboxRelay's own doc comment: "In production
        // Debezium (CDC) streams the outbox table directly, so this relay is not deployed"). CDC reads
        // via WAL and never writes back to the row, so `markPublished` — the only thing that sets
        // status="published" — never runs on the Prisma-backed path; it only runs inside OutboxRelay
        // (local/test, InMemoryOutboxStore). Pruning on status=="published" therefore matched zero
        // production rows forever. Age is the only signal CDC leaves behind, so prune on age alone —
        // `@@index([createdAt])` (platform.prisma) exists for exactly this.
        const stillPending = await core.prisma.outboxEntry.count({
          where: { status: "pending", createdAt: { lt: cutoff } },
        });
        if (stillPending > 0) {
          // Not necessarily lost — CDC gives no completion signal to check against — but a row this
          // far past retention is old enough that CDC lag alone should not explain it. Surfaced rather
          // than pruned silently, so this job cannot mask a stalled replication slot or connector.
          core.logger.warn("outbox pruning rows CDC never confirmed published", {
            count: stillPending,
            retentionDays: core.config.OUTBOX_RETENTION_DAYS,
          });
        }

        // Phase A.13 (Task 8): fail-safe gate for the CATASTROPHIC case the warning above cannot
        // catch — the replication slot itself missing (Debezium never provisioned/connector
        // dropped the slot) or present but never having confirmed a single flush (never started
        // streaming). In that state `stillPending`'s warning is necessarily silent forever (a slot
        // that never streamed produces no signal to count against), so this job would otherwise
        // keep deleting rows nobody has EVER confirmed left the database — the exact "delete an
        // undelivered event" failure this task must not allow. This does not change the existing,
        // deliberate C2-3 behavior (still prunes past-retention rows even when some are individually
        // still "pending" — see scheduler.test.ts) for the normal case where the slot IS active.
        const [slot] = await core.prisma.$queryRaw<{ confirmed_flush_lsn: string | null }[]>`
          SELECT confirmed_flush_lsn FROM pg_replication_slots WHERE slot_name = 'lumo_outbox'
        `;
        if (slot?.confirmed_flush_lsn == null) {
          core.logger.warn("outbox prune skipped: CDC replication slot not found or not streaming");
          return;
        }

        const result = await core.prisma.outboxEntry.deleteMany({
          where: { createdAt: { lt: cutoff } },
        });
        core.logger.info("outbox pruned", { deleted: result.count });
      },
    },
    {
      // Absent KAFKA_CONNECT_URL ⇒ no-op (same present/absent convention as S3/Stripe in config.ts)
      // — local/tests never require Kafka Connect to be reachable to build or run the job list.
      name: "cdc-watchdog",
      intervalMs: core.config.CDC_WATCHDOG_INTERVAL_MS,
      run: async () => {
        if (core.config.KAFKA_CONNECT_URL === undefined) return;
        await runCdcWatchdog({
          connectUrl: core.config.KAFKA_CONNECT_URL,
          connectors: core.config.KAFKA_CONNECT_CDC_CONNECTORS.split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
          maxRestarts: core.config.CDC_WATCHDOG_MAX_RESTARTS,
          restartWindowMs: core.config.CDC_WATCHDOG_RESTART_WINDOW_MS,
          state: cdcWatchdogState,
          clock: core.clock,
          logger: core.logger,
          metrics: core.metrics,
          fetchImpl: fetch,
        });
      },
    },
  ];
}

export function startJobLoop(
  jobs: readonly ScheduledJob[],
  log: Logger,
  lock?: { acquire(key: string, ttlMs: number): Promise<{ release(): Promise<boolean> } | null> },
): NodeJS.Timeout[] {
  return jobs.map((job) =>
    setInterval(() => {
      void (async () => {
        const handle = lock
          ? await lock.acquire(`job:${job.name}`, job.intervalMs)
          : { release: () => Promise.resolve(true) };
        if (handle === null) return; // another instance holds the job
        try {
          await job.run();
        } catch (error) {
          log.error("scheduled job failed", { job: job.name, error: String(error) });
        } finally {
          await handle.release();
        }
      })();
    }, job.intervalMs),
  );
}

export function startScheduler(config: RuntimeConfig, core?: RuntimeCore): Promise<void> {
  const runtime = core ?? buildRuntimeCore(config);
  // H-03: see api.ts — same activation, this process's role suffix.
  const telemetry = startRuntimeTelemetry(config, "scheduler");
  const timers = startJobLoop(buildJobs(runtime), runtime.logger, runtime.distributedLock);

  // F5/F3: same reason as the worker — 22-deployment-scheduler.yaml probes /healthz + /readyz and
  // scrapes /metrics, and this process starts no Fastify server of its own.
  const health = startHealthServer(runtime.health, config.PORT, runtime.metrics);

  logger.info("scheduler started", { jobs: timers.length, env: config.APP_ENV });

  const shutdown = async (): Promise<void> => {
    logger.info("scheduler shutting down");
    health.close();
    for (const timer of timers) clearInterval(timer);
    await runtime.redis.disconnect();
    await runtime.prisma.$disconnect();
    await telemetry.shutdown();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  return Promise.resolve();
}

if (process.argv[1]?.endsWith("scheduler.ts") || process.argv[1]?.endsWith("scheduler.js")) {
  startScheduler(loadRuntimeConfig()).catch((error: unknown) => {
    logger.error("scheduler failed to start", { error: String(error) });
    process.exitCode = 1;
  });
}
