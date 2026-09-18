import type { Database, TransactionClient } from "@platform/db";
import type { DomainEvent } from "@platform/domain";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { SessionTransition, SessionTransitionKind } from "../domain/session-transition";
import type { JourneyStore } from "../ports/journey-store";
import { readScoped } from "./scoped-read";

export interface PrismaJourneyStoreDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  readonly idGenerator: { generate(): string };
}

interface TransitionRow {
  readonly id: string;
  readonly kind: string;
  readonly visitorId: string;
  readonly fromSessionId: string | null;
  readonly toSessionId: string | null;
  readonly reason: string | null;
  readonly actor: string | null;
  readonly occurredAt: Date;
}

function toDomain(row: TransitionRow): SessionTransition {
  return {
    id: row.id,
    kind: row.kind as SessionTransitionKind,
    visitorId: row.visitorId,
    fromSessionId: row.fromSessionId ?? undefined,
    toSessionId: row.toSessionId ?? undefined,
    reason: row.reason ?? undefined,
    actor: row.actor ?? undefined,
    occurredAt: row.occurredAt.toISOString(),
  };
}

/** Production `JourneyStore` on the `customer_360` schema. Append-only, same discipline as
 * `PrismaIdentityDecisionStore` (same package, same convention). `event` is optional — only the two
 * explicit transition kinds publish one; see `JourneyStore.record`'s doc. */
export class PrismaJourneyStore implements JourneyStore {
  private readonly deps: PrismaJourneyStoreDeps;

  constructor(deps: PrismaJourneyStoreDeps) {
    this.deps = deps;
  }

  async record(
    transition: SessionTransition,
    tenantId: string,
    event?: DomainEvent,
    tx?: unknown,
  ): Promise<void> {
    const client = this.requireTx(tx);
    await client.sessionTransition.create({
      data: {
        id: transition.id,
        tenantId,
        kind: transition.kind,
        visitorId: transition.visitorId,
        fromSessionId: transition.fromSessionId ?? null,
        toSessionId: transition.toSessionId ?? null,
        reason: transition.reason ?? null,
        actor: transition.actor ?? null,
        occurredAt: new Date(transition.occurredAt),
      },
    });
    if (event !== undefined) {
      await this.deps.outbox.write([event], this.deps.context, client);
    }
  }

  async listForVisitor(
    visitorId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly SessionTransition[]> {
    return readScoped(this.deps.prisma, tenantId, tx, async (client) => {
      const rows = await client.sessionTransition.findMany({
        where: { tenantId, visitorId },
        orderBy: { occurredAt: "asc" },
      });
      return rows.map(toDomain);
    });
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaJourneyStore.record requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
