import type { IdGenerator } from "@platform/contracts";
import type { Database, TransactionClient } from "@platform/db";
import type { DomainEvent } from "@platform/domain";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import {
  addEdge,
  EMPTY_IDENTITY_GRAPH,
  type IdentifierType,
  type IdentityConfidence,
  type IdentityEdge,
  type IdentityGraph,
} from "@platform/tracking";
import type { IdentityGraphStore } from "../ports/identity-graph-store";

export interface PrismaIdentityGraphStoreDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  readonly idGenerator: IdGenerator;
  /** Tenant scope for every query (ADR-0008 §2) — injected by the composition root. */
  readonly tenantId: string;
}

/**
 * Production `IdentityGraphStore` on the `customer_360` schema. Append-only inserts — same
 * discipline as `@platform/tracking`'s in-process graph, just durable. `loadGraph` replays every
 * row through the pure `addEdge`, so the persisted and in-process graph shapes can never diverge.
 * O(n) in edge count per resolution; acceptable at Phase 6.1 scale, revisited by the read-model
 * work in Phase 6.9 (Identity Explorer) if it becomes a bottleneck.
 */
export class PrismaIdentityGraphStore implements IdentityGraphStore {
  private readonly deps: PrismaIdentityGraphStoreDeps;

  constructor(deps: PrismaIdentityGraphStoreDeps) {
    this.deps = deps;
  }

  async appendEdge(edge: IdentityEdge, event?: DomainEvent, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    await client.identityLink.create({
      data: {
        id: this.deps.idGenerator.generate(),
        tenantId: this.deps.tenantId,
        fromType: edge.fromType,
        fromValue: edge.fromValue,
        toType: edge.toType,
        toValue: edge.toValue,
        confidence: edge.confidence,
        observedAt: new Date(edge.observedAt),
        source: edge.source,
      },
    });
    if (event !== undefined) {
      await this.deps.outbox.write([event], this.deps.context, client);
    }
  }

  async loadGraph(tx?: unknown): Promise<IdentityGraph> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const rows = await client.identityLink.findMany({
      where: { tenantId: this.deps.tenantId },
      orderBy: { observedAt: "asc" },
    });

    let graph = EMPTY_IDENTITY_GRAPH;
    for (const row of rows) {
      graph = addEdge(graph, {
        fromType: row.fromType as IdentifierType,
        fromValue: row.fromValue,
        toType: row.toType as IdentifierType,
        toValue: row.toValue,
        confidence: row.confidence as IdentityConfidence,
        observedAt: row.observedAt.toISOString(),
        source: row.source,
      });
    }
    return graph;
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaIdentityGraphStore.appendEdge requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
