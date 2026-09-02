import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface SegmentCreatedData {
  readonly segmentId: string;
  readonly name: string;
  readonly version: number;
}

/** Raised when `CreateSegment` authors a new segment definition. No rule set on the wire — same
 * ADR-0006 discipline every other engine's events already follow. */
export class SegmentCreated extends DomainEvent {
  readonly eventName = "segment.created";
  readonly data: SegmentCreatedData;

  constructor(props: DomainEventProps, data: SegmentCreatedData) {
    super(props);
    this.data = data;
  }
}
