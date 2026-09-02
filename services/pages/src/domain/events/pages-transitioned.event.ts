import { DomainEvent, type DomainEventProps } from "@platform/domain";

export type PagesEventFamily = "page" | "template";

export interface PagesTransitionedData {
  readonly ref: string;
  readonly family: PagesEventFamily;
  readonly action: string;
}

/**
 * Raised on every page/template lifecycle transition (Sprint 5.4) — a two-dimensional `(family,
 * action)` pair, generalizing the single-dimension dynamic-status-mapping technique used since
 * Notifications. The translator maps this to `pages.<family>.<action>`.
 */
export class PagesTransitioned extends DomainEvent {
  readonly eventName = "pages.transitioned";
  readonly data: PagesTransitionedData;

  constructor(props: DomainEventProps, data: PagesTransitionedData) {
    super(props);
    this.data = data;
  }
}
