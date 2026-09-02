import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { IdentifierType } from "@platform/tracking";
import type { ProfileFieldConfidence } from "../domain/profile-field";

export interface ProfileCreatedData {
  readonly identifierType: IdentifierType;
  readonly identifierValue: string;
  readonly field: string;
  readonly source: string;
  readonly confidence: ProfileFieldConfidence;
  readonly version: number;
}

/** Raised the first time any field is recorded for an identifier — the profile transitions from
 * nonexistent to existing. No field *value* on the wire (ADR-0006: PII stays inside the boundary) —
 * only which field changed and its provenance, same discipline `IdentityLinkObserved` already uses. */
export class ProfileCreated extends DomainEvent {
  readonly eventName = "profile.created";
  readonly data: ProfileCreatedData;

  constructor(props: DomainEventProps, data: ProfileCreatedData) {
    super(props);
    this.data = data;
  }
}
