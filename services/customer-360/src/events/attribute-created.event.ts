import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { IdentifierType } from "@platform/tracking";

export interface AttributeCreatedData {
  readonly identifierType: IdentifierType;
  readonly identifierValue: string;
  readonly attribute: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly version: number;
}

/** Raised the first time any computed attribute is recorded for an identifier. No attribute *value*
 * on the wire — same ADR-0006 discipline `ProfileCreated`/`IdentityLinkObserved` already follow, only
 * heightened here: a computed attribute's whole purpose is often a derived score/segment/flag *about*
 * a person, which is exactly the kind of fact that must never leak onto an integration event. */
export class AttributeCreated extends DomainEvent {
  readonly eventName = "attribute.created";
  readonly data: AttributeCreatedData;

  constructor(props: DomainEventProps, data: AttributeCreatedData) {
    super(props);
    this.data = data;
  }
}
