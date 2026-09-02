import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { IdentifierType } from "@platform/tracking";

export interface CustomerEnteredSegmentData {
  readonly identifierType: IdentifierType;
  readonly identifierValue: string;
  readonly segmentId: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly version: number;
}

/** Raised when `UpdateSegmentMembershipProjection` reports `transition: "entered"` — an identifier's
 * evaluation transitioned into a segment. No evaluated fact values on the wire — same ADR-0006
 * discipline `AttributeCreated`/`AttributeUpdated` already follow. Never raised for a no-op or a
 * version-bump-only re-evaluation that leaves `status` unchanged. */
export class CustomerEnteredSegment extends DomainEvent {
  readonly eventName = "segment_membership.entered";
  readonly data: CustomerEnteredSegmentData;

  constructor(props: DomainEventProps, data: CustomerEnteredSegmentData) {
    super(props);
    this.data = data;
  }
}
