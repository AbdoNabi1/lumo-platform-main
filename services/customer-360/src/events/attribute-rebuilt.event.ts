import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { IdentifierType } from "@platform/tracking";

export interface AttributeRebuiltData {
  readonly identifierType: IdentifierType;
  readonly identifierValue: string;
  readonly attributeCount: number;
  readonly version: number;
}

/** Raised when `RebuildComputedAttributes` recomputes the current-view cache from the durable history
 * ledger — a recovery/consistency signal, not a data change, mirroring `ProfileRebuilt`/
 * `SessionSnapshot`'s own `"rebuilt"` reason exactly. */
export class AttributeRebuilt extends DomainEvent {
  readonly eventName = "attribute.rebuilt";
  readonly data: AttributeRebuiltData;

  constructor(props: DomainEventProps, data: AttributeRebuiltData) {
    super(props);
    this.data = data;
  }
}
