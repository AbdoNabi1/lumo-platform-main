import type { DomainEvent } from "@platform/domain";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { SessionTransition } from "../domain/session-transition";
import type { JourneyStore } from "../ports/journey-store";

export interface InMemoryJourneyStoreDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory adapter — dev/test only. Same outbox-write-on-append shape as
 * `InMemoryIdentityDecisionStore` (same package, same convention): `event` is optional, written to
 * the outbox only for the two explicit kinds (`explicit_merge`/`explicit_split`) that publish their
 * own integration event. */
export class InMemoryJourneyStore implements JourneyStore {
  private readonly transitions: SessionTransition[] = [];
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryJourneyStoreDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async record(transition: SessionTransition, event?: DomainEvent, tx?: unknown): Promise<void> {
    this.transitions.push(transition);
    if (event !== undefined) {
      await this.outbox.write([event], this.context, tx);
    }
  }

  async listForVisitor(visitorId: string): Promise<readonly SessionTransition[]> {
    return this.transitions.filter((transition) => transition.visitorId === visitorId);
  }
}
