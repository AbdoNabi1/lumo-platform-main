import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface ReviewTransitionedData {
  readonly productRef: string;
  readonly customerRef: string;
  readonly action: string;
  readonly ref?: string;
}

/**
 * Raised on every review state change (Sprint 5.2) — status transitions and the three action-only
 * events (vote/report/response) that don't themselves change `status`. The translator maps this to
 * `reviews.review.<action>`.
 */
export class ReviewTransitioned extends DomainEvent {
  readonly eventName = "review.transitioned";
  readonly data: ReviewTransitionedData;

  constructor(props: DomainEventProps, data: ReviewTransitionedData) {
    super(props);
    this.data = data;
  }
}
