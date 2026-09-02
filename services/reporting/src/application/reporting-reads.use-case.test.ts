import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { GetDashboard } from "./get-dashboard.use-case";
import { GetReportDefinition } from "./get-report-definition.use-case";
import { ListDashboards } from "./list-dashboards.use-case";
import { ListReportDefinitions } from "./list-report-definitions.use-case";
import { CreateDashboard, CreateReportDefinition } from "./reporting.use-cases";
import {
  InMemoryAnalyticsReportRepository,
  InMemoryDashboardRepository,
  InMemoryReportDefinitionRepository,
} from "../infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { ReportingEventTranslator } from "../infrastructure/reporting-event-translator";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };

function harness() {
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new ReportingEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "reporting",
  });
  const context = rootEventContext(sequentialIds());
  const reportDefinitions = new InMemoryReportDefinitionRepository({ outbox, context });
  const dashboards = new InMemoryDashboardRepository({ outbox, context });
  const analyticsReports = new InMemoryAnalyticsReportRepository({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const idGenerator = sequentialIds();
  return { reportDefinitions, dashboards, analyticsReports, unitOfWork, idGenerator, clock };
}

describe("Reporting read use-cases (Phase 4 T4.20)", () => {
  it("ListReportDefinitions paginates", async () => {
    const h = harness();
    const create = new CreateReportDefinition(h);
    for (let i = 0; i < 3; i += 1) {
      await create.execute({ name: `report-${i}`, type: "table", metricRefs: ["orders_count"] });
    }

    const page = await new ListReportDefinitions(h).execute({ first: 2 });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items).toHaveLength(2);
    expect(page.value.pageInfo.hasNextPage).toBe(true);

    const rest = await new ListReportDefinitions(h).execute({
      first: 10,
      after: page.value.pageInfo.endCursor ?? undefined,
    });
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.value.items).toHaveLength(1);
    expect(rest.value.pageInfo.hasNextPage).toBe(false);
  });

  it("GetReportDefinition returns the definition, or NotFoundError when absent", async () => {
    const h = harness();
    const created = await new CreateReportDefinition(h).execute({
      name: "orders-by-day",
      type: "table",
      metricRefs: ["orders_count"],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await new GetReportDefinition(h).execute({
      reportDefinitionId: created.value.reportDefinitionId,
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.name).toBe("orders-by-day");

    const missing = await new GetReportDefinition(h).execute({ reportDefinitionId: "nope" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });

  it("ListDashboards paginates", async () => {
    const h = harness();
    const create = new CreateDashboard(h);
    for (let i = 0; i < 3; i += 1) {
      await create.execute({ name: `dashboard-${i}`, tileRefs: [] });
    }

    const page = await new ListDashboards(h).execute({ first: 2 });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items).toHaveLength(2);
    expect(page.value.pageInfo.hasNextPage).toBe(true);

    const rest = await new ListDashboards(h).execute({
      first: 10,
      after: page.value.pageInfo.endCursor ?? undefined,
    });
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.value.items).toHaveLength(1);
    expect(rest.value.pageInfo.hasNextPage).toBe(false);
  });

  it("GetDashboard returns the dashboard, or NotFoundError when absent", async () => {
    const h = harness();
    const created = await new CreateDashboard(h).execute({
      name: "sales-overview",
      tileRefs: ["tile-1"],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await new GetDashboard(h).execute({ dashboardId: created.value.dashboardId });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.name).toBe("sales-overview");

    const missing = await new GetDashboard(h).execute({ dashboardId: "nope" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });
});
