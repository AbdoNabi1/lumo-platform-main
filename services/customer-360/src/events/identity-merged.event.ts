import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { IdentifierType } from "@platform/tracking";

export interface IdentityMergedData {
  readonly decisionId: string;
  readonly subjectType: IdentifierType;
  readonly subjectValue: string;
  readonly mergedType: IdentifierType;
  readonly mergedValue: string;
  readonly reason: string;
  readonly actor: string;
}

/** Raised when an operator/system asserts two previously-unlinked identifiers are the same
 * person. Distinct from {@link IdentityLinkObserved}: a merge is a DECISION with provenance
 * (who, why), not a passively-observed touchpoint. */
export class IdentityMerged extends DomainEvent {
  readonly eventName = "identity.merged";
  readonly data: IdentityMergedData;

  constructor(props: DomainEventProps, data: IdentityMergedData) {
    super(props);
    this.data = data;
  }
}
