import { DomainEvent, type DomainEventProps } from "@platform/domain";

export type TenancyFamily = "tenant" | "workspace";

export interface TenancyChangedData {
  readonly ref: string;
  readonly family: TenancyFamily;
  readonly action: string;
}

/**
 * Raised whenever `Tenant` or `Workspace` changes (ADR-0008 Sprint 5.5/5.6 addenda) — a generic
 * `(family, action)` change event, matching the plural-aggregate-single-event-file precedent
 * (SEO, G4; Coupons, G1). The translator maps this to `tenancy.<family>.<action>`.
 */
export class TenancyChanged extends DomainEvent {
  readonly eventName = "tenancy.changed";
  readonly data: TenancyChangedData;

  constructor(props: DomainEventProps, data: TenancyChangedData) {
    super(props);
    this.data = data;
  }
}
