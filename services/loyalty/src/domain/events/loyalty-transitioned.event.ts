import { DomainEvent, type DomainEventProps } from "@platform/domain";

export type LoyaltyEventFamily = "account" | "points" | "tier" | "reward" | "referral";

export interface LoyaltyTransitionedData {
  readonly customerRef: string;
  readonly family: LoyaltyEventFamily;
  readonly action: string;
  readonly balance: number;
  readonly ref?: string;
}

/**
 * Raised on every loyalty-account state change (Sprint 5.1) — a two-dimensional `(family, action)`
 * pair, generalizing the single-dimension dynamic-status-mapping technique Notifications/Promotions
 * use, because the report's own event naming (`loyalty.account/points/tier/reward/referral.*`)
 * already carries two segments after the context prefix. The translator maps this to
 * `loyalty.<family>.<action>`.
 */
export class LoyaltyTransitioned extends DomainEvent {
  readonly eventName = "loyalty.transitioned";
  readonly data: LoyaltyTransitionedData;

  constructor(props: DomainEventProps, data: LoyaltyTransitionedData) {
    super(props);
    this.data = data;
  }
}
