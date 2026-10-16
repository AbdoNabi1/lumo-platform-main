import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireReporting } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-13T00:00:00.000Z") };

function wire() {
  return wireReporting({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

const TENANT = "tenant-a";

describe("reporting (end to end)", () => {
  it("runs the full lifecycle: create definition -> activate -> generate -> dashboard, publishing canonical events", async () => {
    const app = wire();
    const created = await app.reporting.createReportDefinition({
      tenantId: TENANT,
      name: "Revenue by day",
      type: "table",
      metricRefs: ["revenue"],
    });
    expect(created.status).toBe(201);
    const reportDefinitionId = (created.body as { reportDefinitionId: string }).reportDefinitionId;

    const activated = await app.reporting.advanceReportDefinition({
      tenantId: TENANT,
      reportDefinitionId,
      toStatus: "active",
    });
    expect(activated.status).toBe(200);

    const generated = await app.reporting.generateReport({ tenantId: TENANT, reportDefinitionId });
    expect(generated.status).toBe(200);
    expect((generated.body as { outcome: string }).outcome).toBe("succeeded");

    const dashboard = await app.reporting.createDashboard({
      tenantId: TENANT,
      name: "Overview",
      tileRefs: [reportDefinitionId],
    });
    expect(dashboard.status).toBe(201);

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("reporting.report_definition.active");
    expect(app.deliveredEventTypes).toContain("reporting.report.generated");
  });

  it("rejects creating a duplicate report-definition name (409)", async () => {
    const app = wire();
    await app.reporting.createReportDefinition({
      tenantId: TENANT,
      name: "Revenue",
      type: "table",
      metricRefs: ["revenue"],
    });
    const response = await app.reporting.createReportDefinition({
      tenantId: TENANT,
      name: "Revenue",
      type: "table",
      metricRefs: ["revenue"],
    });
    expect(response.status).toBe(409);
  });

  it("returns 404 for an unknown report definition", async () => {
    const app = wire();
    const response = await app.reporting.advanceReportDefinition({
      tenantId: TENANT,
      reportDefinitionId: "missing",
      toStatus: "active",
    });
    expect(response.status).toBe(404);
  });

  it("rejects an empty report-definition name (422)", async () => {
    const app = wire();
    const response = await app.reporting.createReportDefinition({
      tenantId: TENANT,
      name: "",
      type: "table",
      metricRefs: [],
    });
    expect(response.status).toBe(422);
  });
});
