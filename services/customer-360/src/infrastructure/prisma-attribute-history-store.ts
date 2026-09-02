import type { Database, TransactionClient } from "@platform/db";
import type { DomainEvent } from "@platform/domain";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { AttributeSnapshot, AttributeSnapshotReason } from "../domain/attribute-snapshot";
import type { AttributeHistoryStore } from "../ports/attribute-history-store";
import type { IdentifierRef } from "../ports/identity-decision";
import { attributesToJson, jsonToAttributes } from "./attribute-fields-json";

export interface PrismaAttributeHistoryStoreDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  readonly idGenerator: { generate(): string };
  readonly tenantId: string;
}

interface SnapshotRow {
  readonly identifierType: string;
  readonly identifierValue: string;
  readonly version: number;
  readonly attributes: unknown;
  readonly capturedAt: Date;
  readonly reason: string;
}

function toDomain(row: SnapshotRow): AttributeSnapshot {
  return {
    identifierType: row.identifierType,
    identifierValue: row.identifierValue,
    version: row.version,
    attributes: jsonToAttributes(row.attributes),
    capturedAt: row.capturedAt.toISOString(),
    reason: row.reason as AttributeSnapshotReason,
  };
}

/** Production `AttributeHistoryStore` on the `customer_360` schema. Append-only — same discipline
 * as `PrismaProfileHistoryStore`/`PrismaSessionHistoryStore` (same package, same convention,
 * including the `requireTx` guard so a write can never bypass the unit of work the outbox atomicity
 * depends on, ADR-0003). `event` is optional, mirroring `PrismaSessionHistoryStore`'s own divergence
 * for the same reason (`RebuildComputedAttributes` has nothing new to publish). */
export class PrismaAttributeHistoryStore implements AttributeHistoryStore {
  private readonly deps: PrismaAttributeHistoryStoreDeps;

  constructor(deps: PrismaAttributeHistoryStoreDeps) {
    this.deps = deps;
  }

  async append(snapshot: AttributeSnapshot, event?: DomainEvent, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    await client.computedAttributeSnapshot.create({
      data: {
        id: this.deps.idGenerator.generate(),
        tenantId: this.deps.tenantId,
        identifierType: snapshot.identifierType,
        identifierValue: snapshot.identifierValue,
        version: snapshot.version,
        attributes: attributesToJson(snapshot.attributes),
        capturedAt: new Date(snapshot.capturedAt),
        reason: snapshot.reason,
      },
    });
    if (event !== undefined) {
      await this.deps.outbox.write([event], this.deps.context, client);
    }
  }

  async listFor(identifier: IdentifierRef, tx?: unknown): Promise<readonly AttributeSnapshot[]> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const rows = await client.computedAttributeSnapshot.findMany({
      where: {
        tenantId: this.deps.tenantId,
        identifierType: identifier.type,
        identifierValue: identifier.value,
      },
      orderBy: { capturedAt: "asc" },
    });
    return rows.map(toDomain);
  }

  async latestFor(identifier: IdentifierRef, tx?: unknown): Promise<AttributeSnapshot | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.computedAttributeSnapshot.findFirst({
      where: {
        tenantId: this.deps.tenantId,
        identifierType: identifier.type,
        identifierValue: identifier.value,
      },
      orderBy: { capturedAt: "desc" },
    });
    return row === null ? null : toDomain(row);
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaAttributeHistoryStore.append requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
