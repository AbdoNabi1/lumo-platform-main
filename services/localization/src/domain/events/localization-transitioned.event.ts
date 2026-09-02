import { DomainEvent, type DomainEventProps } from "@platform/domain";

export type LocalizationEventFamily = "locale" | "translation";

export interface LocalizationTransitionedData {
  readonly ref: string;
  readonly family: LocalizationEventFamily;
  readonly action: string;
  readonly key?: string;
}

/**
 * Raised on every locale/translation state change (Sprint 5.4) — a two-dimensional `(family,
 * action)` pair, generalizing the single-dimension dynamic-status-mapping technique used since
 * Notifications. The translator maps this to `localization.<family>.<action>`.
 */
export class LocalizationTransitioned extends DomainEvent {
  readonly eventName = "localization.transitioned";
  readonly data: LocalizationTransitionedData;

  constructor(props: DomainEventProps, data: LocalizationTransitionedData) {
    super(props);
    this.data = data;
  }
}
