import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { AnalyticsReport } from "./analytics-report";
import { Dashboard } from "./dashboard";
import { ReportDefinition } from "./report-definition";
import { AnalyticsMetricSelection } from "./value-objects/report-selection";

describe("ReportDefinition", () => {
  it("starts at draft and raises an event on its first transition", () => {
    const definition = ReportDefinition.create(
      UniqueEntityId.from("report-def-1"),
      "Revenue by day",
      "table",
      [AnalyticsMetricSelection.create("revenue")],
      [],
      [],
    );
    expect(definition.status.value).toBe("draft");
    definition.activate("evt-1", new Date(0));
    expect(definition.status.value).toBe("active");
    const events = definition.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("reporting.transitioned");
  });

  it("rejects an illegal transition (archived -> active, 409)", () => {
    const definition = ReportDefinition.create(
      UniqueEntityId.from("report-def-2"),
      "Revenue by day",
      "table",
      [],
      [],
      [],
    );
    definition.archive("evt-1", new Date(0));
    expect(() => definition.transition("active", "evt-2", new Date(0))).toThrow(BusinessRuleError);
  });
});

describe("Dashboard", () => {
  it("starts active and archives/reactivates", () => {
    const dashboard = Dashboard.create(UniqueEntityId.from("dashboard-1"), "Overview", [
      "report-def-1",
    ]);
    expect(dashboard.status.value).toBe("active");
    dashboard.archive("evt-1", new Date(0));
    expect(dashboard.status.value).toBe("archived");
    dashboard.reactivate("evt-2", new Date(0));
    expect(dashboard.status.value).toBe("active");
  });
});

describe("AnalyticsReport", () => {
  it("records a successful run and raises reporting.report.generated", () => {
    const report = AnalyticsReport.recordSuccess(
      UniqueEntityId.from("report-1"),
      "report-def-1",
      { rows: [] },
      "evt-1",
      new Date(0),
    );
    expect(report.outcome).toBe("succeeded");
    const events = report.pullDomainEvents();
    expect(events).toHaveLength(1);
  });

  it("records a failed run", () => {
    const report = AnalyticsReport.recordFailure(
      UniqueEntityId.from("report-2"),
      "report-def-1",
      "query timeout",
      "evt-1",
      new Date(0),
    );
    expect(report.outcome).toBe("failed");
    expect(report.errorMessage).toBe("query timeout");
  });
});
