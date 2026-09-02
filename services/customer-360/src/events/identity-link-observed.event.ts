import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { IdentifierType, IdentityConfidence } from "@platform/tracking";

export interface IdentityLinkObservedData {
  readonly fromType: IdentifierType;
  readonly fromValue: string;
  readonly toType: IdentifierType;
  readonly toValue: string;
  readonly confidence: IdentityConfidence;
  readonly source: string;
}

/** Raised once per observed edge (doc 17 §4). One event per stitch — never batched — so the
 * outbox/timeline preserves the exact order evidence arrived in. */
export class IdentityLinkObserved extends DomainEvent {
  readonly eventName = "identity.link_observed";
  readonly data: IdentityLinkObservedData;

  constructor(props: DomainEventProps, data: IdentityLinkObservedData) {
    super(props);
    this.data = data;
  }
}
