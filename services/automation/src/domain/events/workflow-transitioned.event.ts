import { DomainEvent, type DomainEventProps } from "@platform/domain";

export type AutomationEventFamily = "workflow" | "execution";

export interface WorkflowTransitionedData {
  readonly name: string;
  readonly family: AutomationEventFamily;
  readonly action: string;
  readonly executionRef?: string;
}

/**
 * Raised on every workflow/execution state change (Sprint 5.3) — a two-dimensional `(family,
 * action)` pair, generalizing the single-dimension dynamic-status-mapping technique Notifications/
 * Promotions use, because the report's own event naming (`automation.workflow/execution.*`) already
 * carries two segments after the context prefix. The translator maps this to
 * `automation.<family>.<action>`.
 */
export class WorkflowTransitioned extends DomainEvent {
  readonly eventName = "workflow.transitioned";
  readonly data: WorkflowTransitionedData;

  constructor(props: DomainEventProps, data: WorkflowTransitionedData) {
    super(props);
    this.data = data;
  }
}
