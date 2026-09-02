import type { DomainEvent } from "@platform/domain";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import {
  addEdge,
  EMPTY_IDENTITY_GRAPH,
  type IdentityEdge,
  type IdentityGraph,
} from "@platform/tracking";
import type { IdentityGraphStore } from "../ports/identity-graph-store";

export interface InMemoryIdentityGraphStoreDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory adapter — dev/test only. Delegates every mutation to `@platform/tracking`'s pure
 * `addEdge`, so the persisted shape and the pure in-process one can never drift. */
export class InMemoryIdentityGraphStore implements IdentityGraphStore {
  private graph: IdentityGraph = EMPTY_IDENTITY_GRAPH;
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryIdentityGraphStoreDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async appendEdge(edge: IdentityEdge, event?: DomainEvent, tx?: unknown): Promise<void> {
    this.graph = addEdge(this.graph, edge);
    if (event !== undefined) {
      await this.outbox.write([event], this.context, tx);
    }
  }

  async loadGraph(): Promise<IdentityGraph> {
    return this.graph;
  }
}
