import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { Dashboard } from "../domain/dashboard";
import { ReportDefinition } from "../domain/report-definition";
import { ReportingEventTranslator } from "./reporting-event-translator";
import { PrismaDashboardRepository, PrismaReportDefinitionRepository } from "./prisma-repositories";

/**
 * Phase 4 T4.20 — real PostgreSQL coverage for the new `list` reads on `ReportDefinition` and
 * `Dashboard`, following the same reference pattern as
 * `services/recommendations/src/infrastructure/prisma-recommendation-model-repository.integration.test.ts`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/reporting test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("Prisma reporting repositories — list (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };

  function wire(tenantId: string) {
    const prisma = createTestPrismaClient(databaseUrl);
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(prisma),
      translator: new ReportingEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "reporting",
    });
    const context = rootEventContext(ids);
    const reportDefinitions = new PrismaReportDefinitionRepository({ prisma, outbox, context });
    const dashboards = new PrismaDashboardRepository({ prisma, outbox, context });
    const unitOfWork = new PrismaUnitOfWork(prisma);
    return {
      prisma,
      reportDefinitions,
      dashboards,
      saveDefinition: (d: ReportDefinition) =>
        unitOfWork.run((tx) => reportDefinitions.save(d, tenantId, tx)),
      saveDashboard: (d: Dashboard) => unitOfWork.run((tx) => dashboards.save(d, tenantId, tx)),
    };
  }

  it("ReportDefinition.list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-reportdefs-${crypto.randomUUID()}`;
    const other = `tenant-itest-reportdefs-other-${crypto.randomUUID()}`;
    const { prisma, reportDefinitions, saveDefinition } = wire(tenantId);
    const { saveDefinition: saveOther } = wire(other);

    for (let i = 0; i < 3; i += 1) {
      await saveDefinition(
        ReportDefinition.create(
          UniqueEntityId.from(ids.generate()),
          `report-${i}`,
          "table",
          [],
          [],
          [],
        ),
      );
    }
    await saveOther(
      ReportDefinition.create(UniqueEntityId.from(ids.generate()), "report-x", "table", [], [], []),
    );

    const page = await reportDefinitions.list({ first: 2 }, tenantId);
    expect(page.items).toHaveLength(2);
    expect(page.pageInfo.hasNextPage).toBe(true);

    const rest = await reportDefinitions.list(
      { first: 10, after: page.pageInfo.endCursor ?? undefined },
      tenantId,
    );
    expect(rest.items).toHaveLength(1);
    expect(rest.pageInfo.hasNextPage).toBe(false);

    await prisma.$disconnect();
  });

  it("Dashboard.list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-dashboards-${crypto.randomUUID()}`;
    const other = `tenant-itest-dashboards-other-${crypto.randomUUID()}`;
    const { prisma, dashboards, saveDashboard } = wire(tenantId);
    const { saveDashboard: saveOther } = wire(other);

    for (let i = 0; i < 3; i += 1) {
      await saveDashboard(
        Dashboard.create(UniqueEntityId.from(ids.generate()), `dashboard-${i}`, []),
      );
    }
    await saveOther(Dashboard.create(UniqueEntityId.from(ids.generate()), "dashboard-x", []));

    const page = await dashboards.list({ first: 2 }, tenantId);
    expect(page.items).toHaveLength(2);
    expect(page.pageInfo.hasNextPage).toBe(true);

    const rest = await dashboards.list(
      { first: 10, after: page.pageInfo.endCursor ?? undefined },
      tenantId,
    );
    expect(rest.items).toHaveLength(1);
    expect(rest.pageInfo.hasNextPage).toBe(false);

    await prisma.$disconnect();
  });
});
