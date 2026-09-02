import { DomainEvent, type DomainEventProps } from "@platform/domain";

export type LicensingFamily =
  | "plan"
  | "plan_version"
  | "subscription"
  | "merchant_feature_override"
  | "merchant_capabilities"
  | "usage_counter"
  | "credit"
  | "invoice";

export interface LicensingChangedData {
  readonly ref: string;
  readonly family: LicensingFamily;
  readonly action: string;
}

/**
 * Raised whenever any of Licensing's 8 aggregates changes (ADR-0018 Sprint 5.5/5.6 addenda) — a
 * generic `(family, action)` change event, matching the plural-aggregate-single-event-file
 * precedent (SEO/Tenancy, G4/G5). The translator maps this to `licensing.<family>.<action>`.
 */
export class LicensingChanged extends DomainEvent {
  readonly eventName = "licensing.changed";
  readonly data: LicensingChangedData;

  constructor(props: DomainEventProps, data: LicensingChangedData) {
    super(props);
    this.data = data;
  }
}
