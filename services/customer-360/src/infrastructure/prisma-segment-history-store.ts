import type { Database, TransactionClient } from "@platform/db";
import type { DomainEvent } from "@platform/domain";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { SegmentHistoryEntry, SegmentHistoryReason } from "../domain/segment-history";
import type { SegmentMembershipStatus } from "../domain/segment-membership";
import type { IdentifierRef } from "../ports/identity-decision";
import type { SegmentHistoryStore } from "../ports/segment-history-store";
import {
  inputsToJson,
  jsonToInputs,
  jsonToMatchedRuleIds,
  matchedRuleIdsToJson,
} from "./segment-fields-json";
import { readScoped } from "./scoped-read";

export interface PrismaSegmentHistoryStoreDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  readonly idGenerator: { generate(): string };
}

interface HistoryRow {
  readonly identifierType: string;
  readonly identifierValue: string;
  readonly segmentId: string;
  readonly status: string;
  readonly enteredAt: Date | null;
  readonly exitedAt: Date | null;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly matchedRuleIds: unknown;
  readonly inputs: unknown;
  readonly evaluatedAt: Date;
  readonly version: number;
  readonly capturedAt: Date;
  readonly reason: string;
}

function toDomain(row: HistoryRow): SegmentHistoryEntry {
  return {
    identifierType: row.identifierType,
    identifierValue: row.identifierValue,
    segmentId: row.segmentId,
    status: row.status as SegmentMembershipStatus,
    enteredAt: row.enteredAt === null ? null : row.enteredAt.toISOString(),
    exitedAt: row.exitedAt === null ? null : row.exitedAt.toISOString(),
    definitionId: row.definitionId,
    definitionVersion: row.definitionVersion,
    matchedRuleIds: jsonToMatchedRuleIds(row.matchedRuleIds),
    inputs: jsonToInputs(row.inputs),
    evaluatedAt: row.evaluatedAt.toISOString(),
    version: row.version,
    capturedAt: row.capturedAt.toISOString(),
    reason: row.reason as SegmentHistoryReason,
  };
}

/** Production `SegmentHistoryStore` on the `customer_360` schema. Append-only — same discipline as
 * `PrismaAttributeHistoryStore` (same package, same convention, including the `requireTx` guard so a
 * write can never bypass the unit of work the outbox atomicity depends on, ADR-0003). `event` is
 * optional, mirroring `PrismaAttributeHistoryStore`'s own divergence for the same reason
 * (`RebuildSegmentMembership` has nothing new to publish). */
export class PrismaSegmentHistoryStore implements SegmentHistoryStore {
  private readonly deps: PrismaSegmentHistoryStoreDeps;

  constructor(deps: PrismaSegmentHistoryStoreDeps) {
    this.deps = deps;
  }

  async append(
    entry: SegmentHistoryEntry,
    tenantId: string,
    event?: DomainEvent,
    tx?: unknown,
  ): Promise<void> {
    const client = this.requireTx(tx);
    await client.segmentHistory.create({
      data: {
        id: this.deps.idGenerator.generate(),
        tenantId,
        identifierType: entry.identifierType,
        identifierValue: entry.identifierValue,
        segmentId: entry.segmentId,
        status: entry.status,
        enteredAt: entry.enteredAt === null ? null : new Date(entry.enteredAt),
        exitedAt: entry.exitedAt === null ? null : new Date(entry.exitedAt),
        definitionId: entry.definitionId,
        definitionVersion: entry.definitionVersion,
        matchedRuleIds: matchedRuleIdsToJson(entry.matchedRuleIds),
        inputs: inputsToJson(entry.inputs),
        evaluatedAt: new Date(entry.evaluatedAt),
        version: entry.version,
        capturedAt: new Date(entry.capturedAt),
        reason: entry.reason,
      },
    });
    if (event !== undefined) {
      await this.deps.outbox.write([event], { ...this.deps.context, tenantId }, client);
    }
  }

  async listFor(
    identifier: IdentifierRef,
    segmentId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly SegmentHistoryEntry[]> {
    return readScoped(this.deps.prisma, tenantId, tx, async (client) => {
      const rows = await client.segmentHistory.findMany({
        where: {
          tenantId,
          identifierType: identifier.type,
          identifierValue: identifier.value,
          segmentId,
        },
        orderBy: { capturedAt: "asc" },
      });
      return rows.map(toDomain);
    });
  }

  async latestFor(
    identifier: IdentifierRef,
    segmentId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<SegmentHistoryEntry | null> {
    return readScoped(this.deps.prisma, tenantId, tx, async (client) => {
      const row = await client.segmentHistory.findFirst({
        where: {
          tenantId,
          identifierType: identifier.type,
          identifierValue: identifier.value,
          segmentId,
        },
        orderBy: { capturedAt: "desc" },
      });
      return row === null ? null : toDomain(row);
    });
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaSegmentHistoryStore.append requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
