import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface SessionMergedData {
  readonly transitionId: string;
  readonly visitorId: string;
  readonly fromSessionId: string;
  readonly toSessionId: string;
  readonly reason: string;
  readonly actor: string;
}

/** Raised by `MergeSession` — an explicit, provenance-carrying assertion that two independently
 * tracked sessions belong to the same continuous journey. Journey-graph-only: never touches the
 * Identity Graph (`@platform/tracking`'s `IdentityGraph`) or Identity Engine's own
 * `IdentityLink`/`IdentityDecision` ledgers — "which sessions form one journey" and "which
 * identifiers belong to one person" are different questions, resolved by different engines. */
export class SessionMerged extends DomainEvent {
  readonly eventName = "session.merged";
  readonly data: SessionMergedData;

  constructor(props: DomainEventProps, data: SessionMergedData) {
    super(props);
    this.data = data;
  }
}
