import type { Database, TransactionClient } from "@platform/db";
import type { IdentifierType } from "@platform/tracking";
import { ConcurrencyError } from "@platform/utils";
import { INITIAL_SEGMENT_VERSION } from "../domain/segment-version";
import type { SegmentMembership, SegmentMembershipStatus } from "../domain/segment-membership";
import type { IdentifierRef } from "../ports/identity-decision";
import type { SegmentStore } from "../ports/segment-store";
import {
  inputsToJson,
  jsonToInputs,
  jsonToMatchedRuleIds,
  matchedRuleIdsToJson,
} from "./segment-fields-json";

export interface PrismaSegmentStoreDeps {
  readonly prisma: Database;
  readonly idGenerator: { generate(): string };
  /** Tenant scope for every query (ADR-0008 §2) — same convention as every other Prisma adapter in
   * this context. */
  readonly tenantId: string;
}

interface MembershipRow {
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
}

function toDomain(row: MembershipRow): SegmentMembership {
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
  };
}

/** Production `SegmentStore` on the `customer_360` schema — one row per `(identifier, segmentId)`
 * pair, **not** one JSON blob per identifier (`ports/segment-store.ts`'s module doc). An upsertable
 * cache, mirroring `PrismaAttributeStore` exactly except for this keying difference. */
export class PrismaSegmentStore implements SegmentStore {
  private readonly deps: PrismaSegmentStoreDeps;

  constructor(deps: PrismaSegmentStoreDeps) {
    this.deps = deps;
  }

  async getCurrent(
    identifier: IdentifierRef,
    segmentId: string,
    tx?: unknown,
  ): Promise<SegmentMembership | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.segmentMembership.findUnique({
      where: {
        tenantId_identifierType_identifierValue_segmentId: {
          tenantId: this.deps.tenantId,
          identifierType: identifier.type,
          identifierValue: identifier.value,
          segmentId,
        },
      },
    });
    return row === null ? null : toDomain(row);
  }

  /** ADR-0060: same `updateMany` + `count === 0` ⇒ `ConcurrencyError` / `expectedVersion === 0` ⇒
   * plain `create` / `expectedVersion === undefined` ⇒ unconditional upsert idiom as
   * `PrismaAttributeStore.saveCurrent`, keyed by `(identifier, segmentId)` instead of `identifier`
   * alone. */
  async saveCurrent(
    membership: SegmentMembership,
    expectedVersion?: number,
    tx?: unknown,
  ): Promise<void> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const where = {
      tenantId_identifierType_identifierValue_segmentId: {
        tenantId: this.deps.tenantId,
        identifierType: membership.identifierType,
        identifierValue: membership.identifierValue,
        segmentId: membership.segmentId,
      },
    };
    const data = {
      status: membership.status,
      enteredAt: membership.enteredAt === null ? null : new Date(membership.enteredAt),
      exitedAt: membership.exitedAt === null ? null : new Date(membership.exitedAt),
      definitionId: membership.definitionId,
      definitionVersion: membership.definitionVersion,
      matchedRuleIds: matchedRuleIdsToJson(membership.matchedRuleIds),
      inputs: inputsToJson(membership.inputs),
      evaluatedAt: new Date(membership.evaluatedAt),
      version: membership.version,
    };

    if (expectedVersion === undefined) {
      await client.segmentMembership.upsert({
        where,
        create: {
          id: this.deps.idGenerator.generate(),
          tenantId: this.deps.tenantId,
          identifierType: membership.identifierType,
          identifierValue: membership.identifierValue,
          segmentId: membership.segmentId,
          ...data,
        },
        update: data,
      });
      return;
    }

    if (expectedVersion === INITIAL_SEGMENT_VERSION) {
      await client.segmentMembership.create({
        data: {
          id: this.deps.idGenerator.generate(),
          tenantId: this.deps.tenantId,
          identifierType: membership.identifierType,
          identifierValue: membership.identifierValue,
          segmentId: membership.segmentId,
          ...data,
        },
      });
      return;
    }

    const updated = await client.segmentMembership.updateMany({
      where: {
        tenantId: this.deps.tenantId,
        identifierType: membership.identifierType,
        identifierValue: membership.identifierValue,
        segmentId: membership.segmentId,
        version: expectedVersion,
      },
      data,
    });
    if (updated.count === 0) {
      throw new ConcurrencyError(
        `SegmentStore CAS conflict for ${membership.identifierType}:${membership.identifierValue}:${membership.segmentId} (expected version ${expectedVersion})`,
      );
    }
  }

  async listForIdentifier(
    identifier: IdentifierRef,
    tx?: unknown,
  ): Promise<readonly SegmentMembership[]> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const rows = await client.segmentMembership.findMany({
      where: {
        tenantId: this.deps.tenantId,
        identifierType: identifier.type,
        identifierValue: identifier.value,
      },
    });
    return rows.map(toDomain);
  }

  async listMembers(
    segmentId: string,
    status: SegmentMembershipStatus = "entered",
    tx?: unknown,
  ): Promise<readonly SegmentMembership[]> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const rows = await client.segmentMembership.findMany({
      where: { tenantId: this.deps.tenantId, segmentId, status },
    });
    return rows.map(toDomain);
  }

  async listIdentifiers(
    tx?: unknown,
  ): Promise<readonly { identifier: IdentifierRef; segmentId: string }[]> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const rows = await client.segmentMembership.findMany({
      where: { tenantId: this.deps.tenantId },
      select: { identifierType: true, identifierValue: true, segmentId: true },
    });
    return rows.map((row) => ({
      identifier: { type: row.identifierType as IdentifierType, value: row.identifierValue },
      segmentId: row.segmentId,
    }));
  }
}
