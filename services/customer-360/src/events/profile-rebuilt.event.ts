import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { IdentifierType } from "@platform/tracking";

export interface ProfileRebuiltData {
  readonly identifierType: IdentifierType;
  readonly identifierValue: string;
  readonly fieldCount: number;
  readonly version: number;
}

/** Raised when `RebuildProfileProjection` recomputes the current view from the durable history
 * ledger — a recovery/consistency signal, not a data change (the fields themselves came from earlier
 * `ProfileCreated`/`ProfileUpdated` events; this just says the cache was refreshed). */
export class ProfileRebuilt extends DomainEvent {
  readonly eventName = "profile.rebuilt";
  readonly data: ProfileRebuiltData;

  constructor(props: DomainEventProps, data: ProfileRebuiltData) {
    super(props);
    this.data = data;
  }
}
