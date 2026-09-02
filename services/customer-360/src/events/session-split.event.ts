import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface SessionSplitData {
  readonly transitionId: string;
  readonly visitorId: string;
  readonly fromSessionId: string;
  readonly toSessionId: string;
  readonly reason: string;
  readonly actor: string;
}

/** Raised by `SplitSession` — an explicit, provenance-carrying correction for a session that
 * actually contains two distinct visits/people (the textbook case: a shared kiosk or family
 * device). Closes `fromSessionId` (`closeReason: "explicit_split"`) and opens `toSessionId` for
 * activity from the split point forward — the original session's own history is never rewritten,
 * only closed, matching the append-only rule the whole engine follows. */
export class SessionSplit extends DomainEvent {
  readonly eventName = "session.split";
  readonly data: SessionSplitData;

  constructor(props: DomainEventProps, data: SessionSplitData) {
    super(props);
    this.data = data;
  }
}
