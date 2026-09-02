import type { Database, TransactionClient } from "@platform/db";
import type { IdentifierType } from "@platform/tracking";
import type { CustomerProfile } from "../domain/customer-profile";
import type { IdentifierRef } from "../ports/identity-decision";
import type { ProfileStore } from "../ports/profile-store";
import { fieldsToJson, jsonToFields } from "./profile-fields-json";

export interface PrismaProfileStoreDeps {
  readonly prisma: Database;
  readonly idGenerator: { generate(): string };
  /** Tenant scope for every query (ADR-0008 §2) — same convention as the Identity Engine's Prisma
   * adapters. */
  readonly tenantId: string;
}

interface CacheRow {
  readonly identifierType: string;
  readonly identifierValue: string;
  readonly fields: unknown;
  readonly version: number;
  readonly updatedAt: Date;
}

function toDomain(row: CacheRow): CustomerProfile {
  return {
    identifierType: row.identifierType,
    identifierValue: row.identifierValue,
    fields: jsonToFields(row.fields),
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Production `ProfileStore` on the `customer_360` schema — an upsertable cache (§15: rebuildable by
 * event replay), unlike the append-only Prisma adapters this package also ships. */
export class PrismaProfileStore implements ProfileStore {
  private readonly deps: PrismaProfileStoreDeps;

  constructor(deps: PrismaProfileStoreDeps) {
    this.deps = deps;
  }

  async getCurrent(identifier: IdentifierRef, tx?: unknown): Promise<CustomerProfile | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.customerProfileCache.findUnique({
      where: {
        tenantId_identifierType_identifierValue: {
          tenantId: this.deps.tenantId,
          identifierType: identifier.type,
          identifierValue: identifier.value,
        },
      },
    });
    return row === null ? null : toDomain(row);
  }

  async saveCurrent(profile: CustomerProfile, tx?: unknown): Promise<void> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const where = {
      tenantId_identifierType_identifierValue: {
        tenantId: this.deps.tenantId,
        identifierType: profile.identifierType,
        identifierValue: profile.identifierValue,
      },
    };
    const data = {
      fields: fieldsToJson(profile.fields),
      version: profile.version,
      updatedAt: new Date(profile.updatedAt),
    };
    await client.customerProfileCache.upsert({
      where,
      create: {
        id: this.deps.idGenerator.generate(),
        tenantId: this.deps.tenantId,
        identifierType: profile.identifierType,
        identifierValue: profile.identifierValue,
        ...data,
      },
      update: data,
    });
  }

  async listIdentifiers(tx?: unknown): Promise<readonly IdentifierRef[]> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const rows = await client.customerProfileCache.findMany({
      where: { tenantId: this.deps.tenantId },
      select: { identifierType: true, identifierValue: true },
    });
    return rows.map((row) => ({
      type: row.identifierType as IdentifierType,
      value: row.identifierValue,
    }));
  }
}
