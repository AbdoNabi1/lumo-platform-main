import { createServer, type Server } from "node:http";
import { healthReportToHttp, type HealthRegistry, type HealthReport } from "@platform/health";
import { logger } from "@platform/utils";

/** Optional metrics source served at `/metrics` and refreshed from each readiness report (F5). */
export interface MetricsSource {
  render(): string;
  updateHealth(report: HealthReport): void;
}

/**
 * Minimal HTTP health surface for the non-HTTP runtime processes (Worker/Scheduler) — F3. No
 * framework (Fastify is not pulled in): a bare Node server so these processes gain the same
 * orchestration probes the API already exposes.
 *   GET /healthz → 200 `{status:"ok"}` (process liveness — the event loop answered)
 *   GET /readyz  → `health.run()` (200 healthy / 503 unhealthy; fail-closed on probe error)
 */
export function startHealthServer(
  health: HealthRegistry,
  port: number,
  metrics?: MetricsSource,
): Server {
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "GET" && url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.method === "GET" && url === "/readyz") {
      health
        .run()
        .then((report) => {
          metrics?.updateHealth(report);
          const { status, body } = healthReportToHttp(report);
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        })
        .catch((error: unknown) => {
          // Fail closed: a probe that throws is reported unhealthy, never healthy.
          res.writeHead(503, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "unhealthy", error: String(error) }));
        });
      return;
    }
    if (req.method === "GET" && url === "/metrics" && metrics !== undefined) {
      res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
      res.end(metrics.render());
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: "NOT_FOUND" }));
  });
  // Health is auxiliary: a bind failure is logged, never allowed to crash the host process.
  server.on("error", (error: unknown) =>
    logger.error("health server error", { error: String(error) }),
  );
  server.listen(port, () => logger.info("health server listening", { port }));
  return server;
}
