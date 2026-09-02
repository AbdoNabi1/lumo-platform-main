import type { DomainEvent } from "@platform/domain";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { IdentityEdge } from "@platform/tracking";
import type { IdentifierRef, IdentityDecision } from "../ports/identity-decision";
import type { IdentityDecisionStore } from "../ports/identity-decision-store";

export interface InMemoryIdentityDecisionStoreDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

export class InMemoryIdentityDecisionStore implements IdentityDecisionStore {
  private readonly decisions: IdentityDecision[] = [];
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryIdentityDecisionStoreDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async record(decision: IdentityDecision, event: DomainEvent, tx?: unknown): Promise<void> {
    this.decisions.push(decision);
    await this.outbox.write([event], this.context, tx);
  }

  async listFor(identifier: IdentifierRef): Promise<readonly IdentityDecision[]> {
    return this.decisions.filter(
      (decision) =>
        (decision.subject.type === identifier.type &&
          decision.subject.value === identifier.value) ||
        (decision.related.type === identifier.type && decision.related.value === identifier.value),
    );
  }

  async retractedEdges(): Promise<readonly IdentityEdge[]> {
    const edges: IdentityEdge[] = [];
    for (const decision of this.decisions) {
      if (decision.kind === "split" && decision.retractedEdge !== undefined) {
        edges.push(decision.retractedEdge);
      }
    }
    return edges;
  }
}
