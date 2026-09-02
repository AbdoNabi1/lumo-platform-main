import type { Database, TransactionClient } from "@platform/db";
import type { DomainEvent } from "@platform/domain";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { ProfileSnapshot, ProfileSnapshotReason } from "../domain/profile-snapshot";
import type { IdentifierRef } from "../ports/identity-decision";
import type { ProfileHistoryStore } from "../ports/profile-history-store";
import { fieldsToJson, jsonToFields } from "./profile-fields-json";

export interface PrismaProfileHistoryStoreDeps {
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
  readonly fields: unknown;
  readonly capturedAt: Date;
  readonly reason: string;
}

function toDomain(row: SnapshotRow): ProfileSnapshot {
  return {
    identifierType: row.identifierType,
    identifierValue: row.identifierValue,
    version: row.version,
    fields: jsonToFields(row.fields),
    capturedAt: row.capturedAt.toISOString(),
    reason: row.reason as ProfileSnapshotReason,
  };
}

/** Production `ProfileHistoryStore` on the `customer_360` schema. Append-only — same discipline as
 * `PrismaIdentityDecisionStore` (same package, same convention, including the `requireTx` guard so a
 * write can never bypass the unit of work the outbox atomicity depends on, ADR-0003). */
export class PrismaProfileHistoryStore implements ProfileHistoryStore {
  private readonly deps: PrismaProfileHistoryStoreDeps;

  constructor(deps: PrismaProfileHistoryStoreDeps) {
    this.deps = deps;
  }

  async append(snapshot: ProfileSnapshot, event: DomainEvent, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    await client.profileSnapshot.create({
      data: {
        id: this.deps.idGenerator.generate(),
        tenantId: this.deps.tenantId,
        identifierType: snapshot.identifierType,
        identifierValue: snapshot.identifierValue,
        version: snapshot.version,
        fields: fieldsToJson(snapshot.fields),
        capturedAt: new Date(snapshot.capturedAt),
        reason: snapshot.reason,
      },
    });
    await this.deps.outbox.write([event], this.deps.context, client);
  }

  async listFor(identifier: IdentifierRef, tx?: unknown): Promise<readonly ProfileSnapshot[]> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const rows = await client.profileSnapshot.findMany({
      where: {
        tenantId: this.deps.tenantId,
        identifierType: identifier.type,
        identifierValue: identifier.value,
      },
      orderBy: { capturedAt: "asc" },
    });
    return rows.map(toDomain);
  }

  async latestFor(identifier: IdentifierRef, tx?: unknown): Promise<ProfileSnapshot | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.profileSnapshot.findFirst({
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
        "PrismaProfileHistoryStore.append requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
