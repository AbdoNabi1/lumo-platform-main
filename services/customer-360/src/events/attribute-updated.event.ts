import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { IdentifierType } from "@platform/tracking";

export interface AttributeUpdatedData {
  readonly identifierType: IdentifierType;
  readonly identifierValue: string;
  readonly attribute: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly version: number;
}

/** Raised when an existing computed attribute on an already-created attribute set changes value —
 * i.e. `applyAttributeUpdate` reported `applied: true`. Never raised for a no-op re-evaluation
 * (`applied: false`), which is the whole point of the no-op guard: a downstream consumer subscribing
 * to this event to trigger its own recompute must see exactly one event per real change, not one per
 * evaluation attempt. No attribute *value* on the wire — see {@link AttributeCreated}'s doc. */
export class AttributeUpdated extends DomainEvent {
  readonly eventName = "attribute.updated";
  readonly data: AttributeUpdatedData;

  constructor(props: DomainEventProps, data: AttributeUpdatedData) {
    super(props);
    this.data = data;
  }
}
