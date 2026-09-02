import { DomainEvent, type DomainEventProps } from "@platform/domain";

export type ExperimentEventFamily = "experiment" | "result" | "winner";

export interface ExperimentTransitionedData {
  readonly name: string;
  readonly family: ExperimentEventFamily;
  readonly action: string;
  readonly variantKey?: string;
}

/**
 * Raised on every experiment state change (Sprint 5.3) — a two-dimensional `(family, action)` pair,
 * generalizing the single-dimension dynamic-status-mapping technique Notifications/Promotions use,
 * because the report's own event naming (`experiment.experiment/result/winner.*`) already carries
 * two segments after the context prefix. The translator maps this to
 * `experiment.<family>.<action>`.
 */
export class ExperimentTransitioned extends DomainEvent {
  readonly eventName = "experiment.transitioned";
  readonly data: ExperimentTransitionedData;

  constructor(props: DomainEventProps, data: ExperimentTransitionedData) {
    super(props);
    this.data = data;
  }
}
