import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { IdentifierType } from "@platform/tracking";
import type { ProfileFieldConfidence } from "../domain/profile-field";

export interface ProfileUpdatedData {
  readonly identifierType: IdentifierType;
  readonly identifierValue: string;
  readonly field: string;
  readonly source: string;
  readonly confidence: ProfileFieldConfidence;
  readonly version: number;
}

/** Raised when an existing field on an already-created profile changes. No field *value* on the wire
 * — see {@link ProfileCreated}'s doc for why. */
export class ProfileUpdated extends DomainEvent {
  readonly eventName = "profile.updated";
  readonly data: ProfileUpdatedData;

  constructor(props: DomainEventProps, data: ProfileUpdatedData) {
    super(props);
    this.data = data;
  }
}
