import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { IdentifierType } from "@platform/tracking";
import type { SegmentMembershipStatus } from "../domain/segment-membership";

export interface MembershipRebuiltData {
  readonly identifierType: IdentifierType;
  readonly identifierValue: string;
  readonly segmentId: string;
  readonly status: SegmentMembershipStatus;
  readonly version: number;
}

/** Raised when `RebuildSegmentMembership` recomputes one `(identifier, segmentId)` cache row from the
 * durable history ledger — a recovery/consistency signal, not a data change, mirroring
 * `AttributeRebuilt`'s own `"rebuilt"` reason exactly. */
export class MembershipRebuilt extends DomainEvent {
  readonly eventName = "segment_membership.rebuilt";
  readonly data: MembershipRebuiltData;

  constructor(props: DomainEventProps, data: MembershipRebuiltData) {
    super(props);
    this.data = data;
  }
}
