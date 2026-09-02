import { DomainEvent, type DomainEventProps } from "@platform/domain";

export type ReportingEventFamily = "report_definition" | "report" | "dashboard";

export interface ReportingTransitionedData {
  readonly name: string;
  readonly family: ReportingEventFamily;
  readonly action: string;
  readonly ref?: string;
}

/**
 * Raised on every reporting-layer state change (Sprint 5.3) — a two-dimensional `(family, action)`
 * pair, generalizing the single-dimension dynamic-status-mapping technique Notifications/Promotions
 * use, because the report's own event naming (`reporting.report_definition/report/dashboard.*`)
 * already carries two segments after the context prefix. The translator maps this to
 * `reporting.<family>.<action>`.
 */
export class ReportingTransitioned extends DomainEvent {
  readonly eventName = "reporting.transitioned";
  readonly data: ReportingTransitionedData;

  constructor(props: DomainEventProps, data: ReportingTransitionedData) {
    super(props);
    this.data = data;
  }
}
