import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface SessionStartedData {
  readonly sessionId: string;
  readonly visitorId: string;
  readonly deviceId?: string;
  readonly journeyId?: string;
  readonly source?: string;
}

/** Raised whenever a new session is opened — organically by `ObserveSession` (first activity for a
 * `session_id`, or a timeout/browser-restart rollover into a replacement session) or explicitly by
 * `ResumeSession`/`SplitSession` (both always open a *new* session rather than reopening a closed
 * one — append-only, no destructive mutation). */
export class SessionStarted extends DomainEvent {
  readonly eventName = "session.started";
  readonly data: SessionStartedData;

  constructor(props: DomainEventProps, data: SessionStartedData) {
    super(props);
    this.data = data;
  }
}
