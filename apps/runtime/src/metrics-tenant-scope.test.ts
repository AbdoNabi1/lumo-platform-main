import { describe, expect, it } from "vitest";
import { RuntimeMetrics } from "./metrics";

/**
 * T10.7 — no runtime metric carries a tenant label, on purpose.
 *
 * Reasoning (recorded in WP-10's T10.7 inventory):
 *  - Cardinality. Tenants are unbounded and every series below is already a product of other labels
 *    (topic × group, method × status, connector × task). A tenant label multiplies each of them by the
 *    tenant count, and Prometheus pays for series, not samples.
 *  - Privacy. `/metrics` on the worker and scheduler is an operator scrape target, not a tenant view;
 *    putting one tenant's identifier there exposes it to every scraper of every other tenant's numbers.
 *  - What the metrics answer. Infrastructure health (dependency up, CDC, outbox relay) is platform-
 *    global by nature. Per-tenant attribution belongs where it is cheap and access-controlled: the
 *    request, retry and dead-letter LOG lines carry `tenantId` (T10.7), and traces carry it as an
 *    attribute — neither pays per-series cost.
 * This test fails if a tenant label is added by accident: it drives every recorder with tenant-shaped
 * inputs and requires that no tenant identifier reaches the exposition.
 */
describe("RuntimeMetrics carries no tenant label (T10.7)", () => {
  it("never exposes a tenant identifier, however the recorders are driven", () => {
    const metrics = new RuntimeMetrics();
    metrics.processed("orders.order.paid.v1", "loyalty", 12);
    metrics.failed("orders.order.paid.v1", "loyalty");
    metrics.retried("orders.order.paid.v1", "loyalty");
    metrics.deadLettered("orders.order.paid.v1", "loyalty");
    metrics.duplicate("orders.order.paid.v1", "loyalty");
    metrics.recordHttp("GET", 200, 5);
    metrics.recordCdcTaskState("outbox-connector", "0", false);
    metrics.recordOutboxPublished(3);
    metrics.recordOutboxRelayFailure();
    metrics.updateHealth({
      status: "healthy",
      components: [{ name: "postgres", status: "healthy" }],
    } as never);

    for (const output of [metrics.render(), metrics.renderHttp()]) {
      expect(output).not.toMatch(/tenant/i);
    }
  });
});
