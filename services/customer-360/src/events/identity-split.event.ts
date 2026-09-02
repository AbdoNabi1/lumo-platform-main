import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { IdentifierType } from "@platform/tracking";

export interface IdentitySplitData {
  readonly decisionId: string;
  readonly retractedFromType: IdentifierType;
  readonly retractedFromValue: string;
  readonly retractedToType: IdentifierType;
  readonly retractedToValue: string;
  readonly reason: string;
  readonly actor: string;
}

/** Raised when a specific observed edge is retracted from resolution — the graph itself stays
 * append-only (doc 17 §4: "a merge is a new observation, never an overwrite"); a split records
 * that one piece of evidence should no longer be trusted, so it is excluded going forward while
 * remaining in history for audit. */
export class IdentitySplit extends DomainEvent {
  readonly eventName = "identity.split";
  readonly data: IdentitySplitData;

  constructor(props: DomainEventProps, data: IdentitySplitData) {
    super(props);
    this.data = data;
  }
}
