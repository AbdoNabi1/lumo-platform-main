import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { SessionCloseReason } from "../domain/session-boundary";

export interface SessionClosedData {
  readonly sessionId: string;
  readonly closeReason: SessionCloseReason;
  readonly pageCount: number;
}

/** Raised whenever a session transitions to `closed` — explicitly via `CloseSession`, or
 * organically as the byproduct of `ObserveSession`'s timeout rollover or `SplitSession`'s
 * truncation of the original session. */
export class SessionClosed extends DomainEvent {
  readonly eventName = "session.closed";
  readonly data: SessionClosedData;

  constructor(props: DomainEventProps, data: SessionClosedData) {
    super(props);
    this.data = data;
  }
}
