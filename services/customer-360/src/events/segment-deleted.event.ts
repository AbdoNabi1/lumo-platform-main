import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface SegmentDeletedData {
  readonly segmentId: string;
  readonly version: number;
}

/** Raised when `DeleteSegment` removes a definition from future evaluation. Never cascades into
 * `SegmentMembership`/`SegmentHistory` rows — this context is append-only/never-delete everywhere
 * else (`SEGMENTATION_MODEL.md` §2). */
export class SegmentDeleted extends DomainEvent {
  readonly eventName = "segment.deleted";
  readonly data: SegmentDeletedData;

  constructor(props: DomainEventProps, data: SegmentDeletedData) {
    super(props);
    this.data = data;
  }
}
