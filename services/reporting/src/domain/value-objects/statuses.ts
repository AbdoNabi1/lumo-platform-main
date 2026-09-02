import { ValueObject } from "@platform/domain";

export type ReportDefinitionStatusValue = "draft" | "active" | "archived";

const REPORT_DEFINITION_TRANSITIONS: Readonly<
  Record<ReportDefinitionStatusValue, readonly ReportDefinitionStatusValue[]>
> = {
  draft: ["active", "archived"],
  active: ["archived"],
  archived: [],
};

export function canTransitionReportDefinition(
  from: ReportDefinitionStatusValue,
  to: ReportDefinitionStatusValue,
): boolean {
  return REPORT_DEFINITION_TRANSITIONS[from].includes(to);
}

/** The lifecycle state of a report definition (draft→active→archived). */
export class ReportDefinitionStatus extends ValueObject<{
  readonly value: ReportDefinitionStatusValue;
}> {
  static draft(): ReportDefinitionStatus {
    return new ReportDefinitionStatus({ value: "draft" });
  }

  static from(value: ReportDefinitionStatusValue): ReportDefinitionStatus {
    return new ReportDefinitionStatus({ value });
  }

  get value(): ReportDefinitionStatusValue {
    return this.props.value;
  }
}

export type DashboardStatusValue = "active" | "archived";

const DASHBOARD_TRANSITIONS: Readonly<
  Record<DashboardStatusValue, readonly DashboardStatusValue[]>
> = {
  active: ["archived"],
  archived: ["active"],
};

export function canTransitionDashboard(
  from: DashboardStatusValue,
  to: DashboardStatusValue,
): boolean {
  return DASHBOARD_TRANSITIONS[from].includes(to);
}

/** The lifecycle state of a dashboard (active/archived). */
export class DashboardStatus extends ValueObject<{ readonly value: DashboardStatusValue }> {
  static active(): DashboardStatus {
    return new DashboardStatus({ value: "active" });
  }

  static from(value: DashboardStatusValue): DashboardStatus {
    return new DashboardStatus({ value });
  }

  get value(): DashboardStatusValue {
    return this.props.value;
  }
}
