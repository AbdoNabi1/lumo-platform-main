import { describe, expect, it } from "vitest";
import type { IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { AnalyticsReport } from "../domain/analytics-report";
import { Dashboard } from "../domain/dashboard";
import { ReportDefinition } from "../domain/report-definition";
import {
  InMemoryAnalyticsReportRepository,
  InMemoryDashboardRepository,
  InMemoryReportDefinitionRepository,
} from "./in-memory-repositories";
import { ReportingEventTranslator } from "./reporting-event-translator";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

function wire() {
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new ReportingEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date(0) },
    producer: "reporting",
  });
  const context = rootEventContext(sequentialIds());
  return {
    reportDefinitions: new InMemoryReportDefinitionRepository({ outbox, context }),
    dashboards: new InMemoryDashboardRepository({ outbox, context }),
  };
}

function definition(name: string) {
  return ReportDefinition.create(
    UniqueEntityId.from("report-def-shared"),
    name,
    "table",
    [],
    [],
    [],
  );
}

describe("Reporting in-memory repositories tenant isolation (ADR-0014, WP-10 T10.3)", () => {
  it("keeps the same report-definition id separate per tenant: reads, name lookups and lists never cross", async () => {
    const { reportDefinitions } = wire();
    await reportDefinitions.save(definition("Revenue A"), "tenant-a");
    await reportDefinitions.save(definition("Revenue B"), "tenant-b");

    expect((await reportDefinitions.findById("report-def-shared", "tenant-a"))?.name).toBe(
      "Revenue A",
    );
    expect((await reportDefinitions.findById("report-def-shared", "tenant-b"))?.name).toBe(
      "Revenue B",
    );
    expect(await reportDefinitions.findById("report-def-shared", "tenant-c")).toBeNull();
    expect(await reportDefinitions.findByName("Revenue B", "tenant-a")).toBeNull();
    expect((await reportDefinitions.list({ first: 10 }, "tenant-a")).items).toHaveLength(1);
    expect((await reportDefinitions.list({ first: 10 }, "tenant-c")).items).toHaveLength(0);
  });

  it("keeps the same dashboard id separate per tenant", async () => {
    const { dashboards } = wire();
    await dashboards.save(
      Dashboard.create(UniqueEntityId.from("dashboard-shared"), "Overview", []),
      "tenant-a",
    );

    expect(await dashboards.findById("dashboard-shared", "tenant-a")).not.toBeNull();
    expect(await dashboards.findById("dashboard-shared", "tenant-b")).toBeNull();
    expect(await dashboards.findByName("Overview", "tenant-b")).toBeNull();
  });
});

describe("Reporting repositories write-time tenant (ADR-0014 amendment 2026-09-18)", () => {
  it("carries each call's tenantId into the outbox envelope, not the singleton context's", async () => {
    await assertWriteTimeTenant("reporting", async (outbox, tenantId) => {
      const context = rootEventContext(sequentialIds());
      const definitions = new InMemoryReportDefinitionRepository({ outbox, context });
      const dashboards = new InMemoryDashboardRepository({ outbox, context });
      const reports = new InMemoryAnalyticsReportRepository({ outbox, context });

      const def = definition("Revenue");
      def.activate("evt-def", new Date(0));
      await definitions.save(def, tenantId);

      const dash = Dashboard.create(UniqueEntityId.from("dashboard-1"), "Overview", []);
      dash.archive("evt-dash", new Date(0));
      await dashboards.save(dash, tenantId);

      await reports.save(
        AnalyticsReport.recordSuccess(
          UniqueEntityId.from("report-1"),
          "report-def-shared",
          { rows: [] },
          "evt-report",
          new Date(0),
        ),
        tenantId,
      );
    });
  });
});
