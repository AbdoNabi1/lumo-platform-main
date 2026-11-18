import { describe, expect, it } from "vitest";
import { createFakePrisma } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { rootEventContext } from "@platform/messaging";
import {
  assertWriteTimeTenant,
  CapturingOutboxWriter,
  tenantRowIsolationCases,
  type TenantRowStore,
} from "@platform/messaging/testing";
import { ConcurrencyError } from "@platform/utils";
import { AnalyticsReport } from "../domain/analytics-report";
import { Dashboard } from "../domain/dashboard";
import { ReportDefinition } from "../domain/report-definition";
import {
  AnalyticsDimensionSelection,
  AnalyticsMetricSelection,
  CronSchedule,
  ReportFilter,
} from "../domain/value-objects/report-selection";
import { DashboardStatus, ReportDefinitionStatus } from "../domain/value-objects/statuses";
import {
  PrismaAnalyticsReportRepository,
  PrismaDashboardRepository,
  PrismaReportDefinitionRepository,
} from "./prisma-repositories";

/**
 * The Reporting Prisma repositories over `createFakePrisma`, which applies every `where` literally
 * (no RLS): what passes here passes because the repository scoped its own query. The real-Postgres
 * suite (`prisma-reporting-repositories.integration.test.ts`) only runs where `DATABASE_URL_TEST`
 * is set.
 */
const context = rootEventContext({ generate: () => "evt-x" });
const at = new Date("2026-10-18T00:00:00.000Z");
const id = (value: string) => UniqueEntityId.from(value);

function wire() {
  const fake = createFakePrisma();
  const outbox = new CapturingOutboxWriter();
  const deps = { prisma: fake.database, outbox: outbox as never, context };
  return {
    fake,
    outbox,
    tx: fake.database as unknown,
    definitions: new PrismaReportDefinitionRepository(deps),
    dashboards: new PrismaDashboardRepository(deps),
    reports: new PrismaAnalyticsReportRepository(deps),
  };
}

function definition(key: string, name = key): ReportDefinition {
  return ReportDefinition.create(
    id(key),
    name,
    "table",
    [AnalyticsMetricSelection.create("revenue")],
    [],
    [],
  );
}

describe("PrismaReportDefinitionRepository", () => {
  it("round-trips the full report shape, including the cron schedule", async () => {
    const { fake, definitions, tx } = wire();
    const created = ReportDefinition.create(
      id("rd-1"),
      "Weekly revenue",
      "cohort",
      [AnalyticsMetricSelection.create("revenue", "sum(amount)")],
      [AnalyticsDimensionSelection.create("channel")],
      [ReportFilter.create("country", "in", ["EG", "SA"])],
      CronSchedule.create("0 6 * * 1"),
    );
    await definitions.save(created, "tenant-a", tx);

    expect(fake.rowsOf("reportDefinition")[0]).toMatchObject({
      tenantId: "tenant-a",
      type: "cohort",
      metrics: [{ metricRef: "revenue", customExpression: "sum(amount)" }],
      dimensions: [{ dimensionRef: "channel" }],
      filters: [{ field: "country", operator: "in", value: ["EG", "SA"] }],
      cronExpression: "0 6 * * 1",
      status: "draft",
      version: 1,
    });
    const read = await definitions.findByName("Weekly revenue", "tenant-a");
    expect(read?.type).toBe("cohort");
    expect(read?.metrics[0]?.customExpression).toBe("sum(amount)");
    expect(read?.dimensions[0]?.dimensionRef).toBe("channel");
    expect(read?.filters[0]?.value).toEqual(["EG", "SA"]);
    expect(read?.schedule?.expression).toBe("0 6 * * 1");
    expect(read?.status.value).toBe("draft");
  });

  it("reads an unscheduled definition back without a schedule", async () => {
    const { definitions, tx } = wire();
    await definitions.save(definition("rd-1"), "tenant-a", tx);
    const read = await definitions.findById("rd-1", "tenant-a", tx);
    expect(read?.schedule).toBeUndefined();
    expect(await definitions.findById("rd-1", "tenant-b")).toBeNull();
  });

  it("persists an activation, writing its event under the call's tenant", async () => {
    const { fake, outbox, definitions, tx } = wire();
    await definitions.save(definition("rd-1", "Revenue"), "tenant-a", tx);
    const loaded = await definitions.findById("rd-1", "tenant-a");
    if (loaded === null) throw new Error("expected the definition");

    loaded.activate("evt-1", at);
    await definitions.save(loaded, "tenant-a", tx);

    expect(fake.rowsOf("reportDefinition")[0]).toMatchObject({ status: "active", version: 2 });
    const written = outbox.writes.find((w) => w.events.length > 0);
    expect(written?.context.tenantId).toBe("tenant-a");
    expect(written?.events[0]).toMatchObject({
      data: { name: "Revenue", family: "report_definition", action: "active" },
    });
  });

  it("rejects a stale version, lists a page at a time, and refuses to save outside a transaction", async () => {
    const { definitions, tx } = wire();
    for (const n of [1, 2, 3]) await definitions.save(definition(`rd-${n}`), "tenant-a", tx);
    const stale = ReportDefinition.reconstitute(
      id("rd-1"),
      "rd-1",
      "table",
      [],
      [],
      [],
      ReportDefinitionStatus.draft(),
      6,
    );
    stale.archive("evt", at);
    await expect(definitions.save(stale, "tenant-a", tx)).rejects.toBeInstanceOf(ConcurrencyError);
    await expect(definitions.save(stale, "tenant-a")).rejects.toThrow(/transaction client/);

    const first = await definitions.list({ first: 2 }, "tenant-a");
    expect(first.items.map((d) => d.name)).toEqual(["rd-1", "rd-2"]);
    expect(first.pageInfo.hasNextPage).toBe(true);
    const rest = await definitions.list(
      { first: 2, after: first.pageInfo.endCursor ?? undefined },
      "tenant-a",
      tx,
    );
    expect(rest.items.map((d) => d.name)).toEqual(["rd-3"]);
  });
});

describe("PrismaDashboardRepository", () => {
  it("creates an active dashboard with its tiles, then archives it", async () => {
    const { fake, dashboards, tx } = wire();
    await dashboards.save(
      Dashboard.create(id("db-1"), "Overview", ["rd-1", "rd-2"]),
      "tenant-a",
      tx,
    );
    expect(fake.rowsOf("dashboard")[0]).toMatchObject({
      tileRefs: ["rd-1", "rd-2"],
      status: "active",
      version: 1,
    });

    const loaded = await dashboards.findByName("Overview", "tenant-a", tx);
    if (loaded === null) throw new Error("expected the dashboard");
    loaded.archive("evt-1", at);
    await dashboards.save(loaded, "tenant-a", tx);

    const reread = await dashboards.findById("db-1", "tenant-a");
    expect(reread?.status.value).toBe("archived");
    expect(reread?.tileRefs).toEqual(["rd-1", "rd-2"]);
    expect(reread?.version).toBe(2);
  });

  it("rejects a stale version, lists a page at a time, and refuses to save outside a transaction", async () => {
    const { dashboards, tx } = wire();
    await dashboards.save(Dashboard.create(id("db-1"), "A", []), "tenant-a", tx);
    await dashboards.save(Dashboard.create(id("db-2"), "B", []), "tenant-a", tx);
    const stale = Dashboard.reconstitute(id("db-1"), "A", [], DashboardStatus.active(), 3);
    stale.archive("evt", at);
    await expect(dashboards.save(stale, "tenant-a", tx)).rejects.toBeInstanceOf(ConcurrencyError);
    await expect(dashboards.save(stale, "tenant-a")).rejects.toThrow(/transaction client/);

    const first = await dashboards.list({ first: 1 }, "tenant-a", tx);
    expect(first.items.map((d) => d.name)).toEqual(["A"]);
    const rest = await dashboards.list(
      { first: 1, after: first.pageInfo.endCursor ?? undefined },
      "tenant-a",
    );
    expect(rest.items.map((d) => d.name)).toEqual(["B"]);
  });
});

describe("PrismaAnalyticsReportRepository", () => {
  it("records a successful run with its result data", async () => {
    const { fake, outbox, reports, tx } = wire();
    await reports.save(
      AnalyticsReport.recordSuccess(id("run-1"), "rd-1", { rows: [[1, 2]] }, "evt-1", at),
      "tenant-a",
      tx,
    );

    expect(fake.rowsOf("analyticsReport")[0]).toMatchObject({
      tenantId: "tenant-a",
      outcome: "succeeded",
      resultData: { rows: [[1, 2]] },
      errorMessage: null,
    });
    const read = await reports.findById("run-1", "tenant-a");
    expect(read?.outcome).toBe("succeeded");
    expect(read?.resultData).toEqual({ rows: [[1, 2]] });
    expect(read?.errorMessage).toBeUndefined();
    expect(read?.generatedAt.toISOString()).toBe(at.toISOString());
    expect(outbox.writes[0]?.events[0]).toMatchObject({
      data: { family: "report", action: "generated" },
    });
  });

  it("records a failed run with its error and no result data", async () => {
    const { fake, reports, tx } = wire();
    await reports.save(
      AnalyticsReport.recordFailure(id("run-1"), "rd-1", "timeout", "evt-1", at),
      "tenant-a",
      tx,
    );

    expect(fake.rowsOf("analyticsReport")[0]).toMatchObject({
      resultData: null,
      errorMessage: "timeout",
    });
    const read = await reports.findById("run-1", "tenant-a", tx);
    expect(read?.outcome).toBe("failed");
    expect(read?.errorMessage).toBe("timeout");
    expect(await reports.findById("run-1", "tenant-b", tx)).toBeNull();
  });

  it("refuses to save outside a unit-of-work transaction", async () => {
    const { reports } = wire();
    const run = AnalyticsReport.recordFailure(id("run-1"), "rd-1", "timeout", "evt-1", at);
    await expect(reports.save(run, "tenant-a")).rejects.toThrow(/transaction client/);
  });
});

it("merges the per-call tenantId into the outbox event context at write time (Prisma)", async () => {
  await assertWriteTimeTenant("reporting (prisma)", async (outbox, tenantId) => {
    const fake = createFakePrisma();
    const repo = new PrismaAnalyticsReportRepository({
      prisma: fake.database,
      outbox: outbox as never,
      context,
    });
    await repo.save(
      AnalyticsReport.recordSuccess(id("run-1"), "rd-1", {}, "evt-1", at),
      tenantId,
      fake.database,
    );
  });
});

// ── T10.5 row isolation (shared harness) ─────────────────────────────────────────────────────────
// An update only rewrites `status`, so a forged write is made observable by archiving: `find`
// reports an archived row with an `archived:` prefix on its marker (the marker rides in a field
// written only on create — the first metric ref, the first tile ref).
function definitionStore(): TenantRowStore {
  const { definitions, tx } = wire();
  const marker = (d: ReportDefinition | null) =>
    d === null
      ? null
      : `${d.status.value === "archived" ? "archived:" : ""}${d.metrics[0]?.metricRef ?? ""}`;
  const metrics = (m: string) => [AnalyticsMetricSelection.create(m)];
  return {
    insert: (tenantId, key, m) =>
      definitions.save(
        ReportDefinition.create(id(key), key, "table", metrics(m), [], []),
        tenantId,
        tx,
      ),
    find: async (tenantId, key) => marker(await definitions.findByName(key, tenantId)),
    list: async (tenantId) =>
      (await definitions.list({ first: 50 }, tenantId)).items.map((d) => marker(d) ?? ""),
    update: async (tenantId, key, m) => {
      const forged = ReportDefinition.reconstitute(
        id(key),
        key,
        "table",
        metrics(m),
        [],
        [],
        ReportDefinitionStatus.draft(),
        1,
      );
      forged.archive("evt-forged", at);
      await definitions.save(forged, tenantId, tx);
    },
  };
}

function dashboardStore(): TenantRowStore {
  const { dashboards, tx } = wire();
  const marker = (d: Dashboard | null) =>
    d === null ? null : `${d.status.value === "archived" ? "archived:" : ""}${d.tileRefs[0] ?? ""}`;
  return {
    insert: (tenantId, key, tile) =>
      dashboards.save(Dashboard.create(id(key), key, [tile]), tenantId, tx),
    find: async (tenantId, key) => marker(await dashboards.findByName(key, tenantId)),
    list: async (tenantId) =>
      (await dashboards.list({ first: 50 }, tenantId)).items.map((d) => marker(d) ?? ""),
    update: async (tenantId, key, tile) => {
      const forged = Dashboard.reconstitute(id(key), key, [tile], DashboardStatus.active(), 1);
      forged.archive("evt-forged", at);
      await dashboards.save(forged, tenantId, tx);
    },
  };
}

describe("reporting tenant isolation over fake-prisma (T10.5)", () => {
  const layer = "prisma repository over fake-prisma (app-layer where, no RLS)";
  for (const fixture of [
    { context: "reporting/report-definition", layer, make: definitionStore },
    { context: "reporting/dashboard", layer, make: dashboardStore },
  ])
    for (const c of tenantRowIsolationCases(fixture)) it(c.name, c.run);
});
