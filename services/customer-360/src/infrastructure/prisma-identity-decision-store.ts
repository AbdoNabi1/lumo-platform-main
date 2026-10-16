import type { IdGenerator } from "@platform/contracts";
import type { Database, TransactionClient } from "@platform/db";
import type { DomainEvent } from "@platform/domain";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { IdentifierType, IdentityConfidence, IdentityEdge } from "@platform/tracking";
import type { IdentifierRef, IdentityDecision } from "../ports/identity-decision";
import type { IdentityDecisionStore } from "../ports/identity-decision-store";
import { readScoped } from "./scoped-read";

export interface PrismaIdentityDecisionStoreDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  readonly idGenerator: IdGenerator;
}

/** Production `IdentityDecisionStore` on the `customer_360` schema. Append-only, same discipline
 * as {@link PrismaIdentityGraphStore}. */
export class PrismaIdentityDecisionStore implements IdentityDecisionStore {
  private readonly deps: PrismaIdentityDecisionStoreDeps;

  constructor(deps: PrismaIdentityDecisionStoreDeps) {
    this.deps = deps;
  }

  async record(
    decision: IdentityDecision,
    event: DomainEvent,
    tenantId: string,
    tx?: unknown,
  ): Promise<void> {
    const client = this.requireTx(tx);
    await client.identityDecision.create({
      data: {
        id: decision.id,
        tenantId,
        kind: decision.kind,
        subjectType: decision.subject.type,
        subjectValue: decision.subject.value,
        relatedType: decision.related.type,
        relatedValue: decision.related.value,
        retractedFromType: decision.retractedEdge?.fromType,
        retractedFromValue: decision.retractedEdge?.fromValue,
        retractedToType: decision.retractedEdge?.toType,
        retractedToValue: decision.retractedEdge?.toValue,
        retractedConfidence: decision.retractedEdge?.confidence,
        retractedObservedAt:
          decision.retractedEdge === undefined
            ? undefined
            : new Date(decision.retractedEdge.observedAt),
        retractedSource: decision.retractedEdge?.source,
        reason: decision.reason,
        actor: decision.actor,
        occurredAt: new Date(decision.occurredAt),
      },
    });
    await this.deps.outbox.write([event], { ...this.deps.context, tenantId }, client);
  }

  async listFor(
    identifier: IdentifierRef,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly IdentityDecision[]> {
    return readScoped(this.deps.prisma, tenantId, tx, async (client) => {
      const rows = await client.identityDecision.findMany({
        where: {
          tenantId,
          OR: [
            { subjectType: identifier.type, subjectValue: identifier.value },
            { relatedType: identifier.type, relatedValue: identifier.value },
          ],
        },
        orderBy: { occurredAt: "asc" },
      });
      return rows.map(toDomainDecision);
    });
  }

  async retractedEdges(tenantId: string, tx?: unknown): Promise<readonly IdentityEdge[]> {
    return readScoped(this.deps.prisma, tenantId, tx, async (client) => {
      const rows = await client.identityDecision.findMany({
        where: { tenantId, kind: "split" },
      });
      const edges: IdentityEdge[] = [];
      for (const row of rows) {
        const edge = toRetractedEdge(row);
        if (edge !== undefined) edges.push(edge);
      }
      return edges;
    });
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaIdentityDecisionStore.record requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}

interface IdentityDecisionRow {
  readonly id: string;
  readonly kind: string;
  readonly subjectType: string;
  readonly subjectValue: string;
  readonly relatedType: string;
  readonly relatedValue: string;
  readonly retractedFromType: string | null;
  readonly retractedFromValue: string | null;
  readonly retractedToType: string | null;
  readonly retractedToValue: string | null;
  readonly retractedConfidence: string | null;
  readonly retractedObservedAt: Date | null;
  readonly retractedSource: string | null;
  readonly reason: string;
  readonly actor: string;
  readonly occurredAt: Date;
}

function toRetractedEdge(row: IdentityDecisionRow): IdentityEdge | undefined {
  if (
    row.retractedFromType === null ||
    row.retractedFromValue === null ||
    row.retractedToType === null ||
    row.retractedToValue === null ||
    row.retractedConfidence === null ||
    row.retractedObservedAt === null ||
    row.retractedSource === null
  ) {
    return undefined;
  }
  return {
    fromType: row.retractedFromType as IdentifierType,
    fromValue: row.retractedFromValue,
    toType: row.retractedToType as IdentifierType,
    toValue: row.retractedToValue,
    confidence: row.retractedConfidence as IdentityConfidence,
    observedAt: row.retractedObservedAt.toISOString(),
    source: row.retractedSource,
  };
}

function toDomainDecision(row: IdentityDecisionRow): IdentityDecision {
  return {
    id: row.id,
    kind: row.kind === "merge" ? "merge" : "split",
    subject: { type: row.subjectType as IdentifierType, value: row.subjectValue },
    related: { type: row.relatedType as IdentifierType, value: row.relatedValue },
    retractedEdge: toRetractedEdge(row),
    reason: row.reason,
    actor: row.actor,
    occurredAt: row.occurredAt.toISOString(),
  };
}
