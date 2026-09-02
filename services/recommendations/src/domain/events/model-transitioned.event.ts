import { DomainEvent, type DomainEventProps } from "@platform/domain";

export type RecommendationEventFamily = "model" | "set";

export interface ModelTransitionedData {
  readonly modelName: string;
  readonly family: RecommendationEventFamily;
  readonly action: string;
  readonly anchorRef?: string;
}

/**
 * Raised on every recommendation-model state change (Sprint 5.2) — a two-dimensional `(family,
 * action)` pair, generalizing the single-dimension dynamic-status-mapping technique Notifications/
 * Promotions use, because the report's own event naming (`recommendations.model/set.*`) already
 * carries two segments after the context prefix. The translator maps this to
 * `recommendations.<family>.<action>`.
 */
export class ModelTransitioned extends DomainEvent {
  readonly eventName = "model.transitioned";
  readonly data: ModelTransitionedData;

  constructor(props: DomainEventProps, data: ModelTransitionedData) {
    super(props);
    this.data = data;
  }
}
