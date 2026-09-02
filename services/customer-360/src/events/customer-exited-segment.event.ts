import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { IdentifierType } from "@platform/tracking";

export interface CustomerExitedSegmentData {
  readonly identifierType: IdentifierType;
  readonly identifierValue: string;
  readonly segmentId: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly version: number;
}

/** Raised when `UpdateSegmentMembershipProjection` reports `transition: "exited"` — an identifier's
 * evaluation transitioned out of a segment. Same payload shape as `CustomerEnteredSegment`. */
export class CustomerExitedSegment extends DomainEvent {
  readonly eventName = "segment_membership.exited";
  readonly data: CustomerExitedSegmentData;

  constructor(props: DomainEventProps, data: CustomerExitedSegmentData) {
    super(props);
    this.data = data;
  }
}
