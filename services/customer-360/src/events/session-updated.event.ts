import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface SessionUpdatedData {
  readonly sessionId: string;
  readonly pageCount: number;
}

/** Raised each time `ObserveSession` folds one more activity into an already-open session (not on
 * the activity that opens it — that raises `SessionStarted` instead). */
export class SessionUpdated extends DomainEvent {
  readonly eventName = "session.updated";
  readonly data: SessionUpdatedData;

  constructor(props: DomainEventProps, data: SessionUpdatedData) {
    super(props);
    this.data = data;
  }
}
