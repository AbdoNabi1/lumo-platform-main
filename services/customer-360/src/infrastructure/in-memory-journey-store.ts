import type { DomainEvent } from "@platform/domain";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { SessionTransition } from "../domain/session-transition";
import type { JourneyStore } from "../ports/journey-store";
import { bucket } from "./tenant-seed";

export interface InMemoryJourneyStoreDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory adapter — dev/test only. Same outbox-write-on-append shape as
 * `InMemoryIdentityDecisionStore` (same package, same convention): `event` is optional, written to
 * the outbox only for the two explicit kinds (`explicit_merge`/`explicit_split`) that publish their
 * own integration event. */
export class InMemoryJourneyStore implements JourneyStore {
  private readonly tenants = new Map<string, SessionTransition[]>();

  private transitions(tenantId: string): SessionTransition[] {
    return bucket(this.tenants, tenantId, () => []);
  }
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryJourneyStoreDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async record(
    transition: SessionTransition,
    tenantId: string,
    event?: DomainEvent,
    tx?: unknown,
  ): Promise<void> {
    this.transitions(tenantId).push(transition);
    if (event !== undefined) {
      await this.outbox.write([event], { ...this.context, tenantId }, tx);
    }
  }

  async listForVisitor(visitorId: string, tenantId: string): Promise<readonly SessionTransition[]> {
    return this.transitions(tenantId).filter((transition) => transition.visitorId === visitorId);
  }
}
