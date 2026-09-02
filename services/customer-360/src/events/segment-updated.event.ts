import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface SegmentUpdatedData {
  readonly segmentId: string;
  readonly name: string;
  readonly version: number;
}

/** Raised when `UpdateSegment` changes an existing segment definition's rule set/metadata. Same
 * payload shape as `SegmentCreated`. */
export class SegmentUpdated extends DomainEvent {
  readonly eventName = "segment.updated";
  readonly data: SegmentUpdatedData;

  constructor(props: DomainEventProps, data: SegmentUpdatedData) {
    super(props);
    this.data = data;
  }
}
