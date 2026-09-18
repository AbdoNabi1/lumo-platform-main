import type { Database, TransactionClient } from "@platform/db";
import type { IdentifierType } from "@platform/tracking";
import { ConcurrencyError } from "@platform/utils";
import { INITIAL_ATTRIBUTE_VERSION } from "../domain/attribute-version";
import type { ComputedAttribute } from "../domain/computed-attribute";
import type { AttributeStore } from "../ports/attribute-store";
import type { IdentifierRef } from "../ports/identity-decision";
import { attributesToJson, jsonToAttributes } from "./attribute-fields-json";
import { readScoped } from "./scoped-read";

export interface PrismaAttributeStoreDeps {
  readonly prisma: Database;
  readonly idGenerator: { generate(): string };
}

interface CacheRow {
  readonly identifierType: string;
  readonly identifierValue: string;
  readonly attributes: unknown;
  readonly version: number;
  readonly updatedAt: Date;
}

function toDomain(row: CacheRow): ComputedAttribute {
  return {
    identifierType: row.identifierType,
    identifierValue: row.identifierValue,
    attributes: jsonToAttributes(row.attributes),
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Production `AttributeStore` on the `customer_360` schema — an upsertable cache (mirrors
 * `PrismaProfileStore`/`PrismaSessionStore` exactly). */
export class PrismaAttributeStore implements AttributeStore {
  private readonly deps: PrismaAttributeStoreDeps;

  constructor(deps: PrismaAttributeStoreDeps) {
    this.deps = deps;
  }

  async getCurrent(
    identifier: IdentifierRef,
    tenantId: string,
    tx?: unknown,
  ): Promise<ComputedAttribute | null> {
    return readScoped(this.deps.prisma, tenantId, tx, async (client) => {
      const row = await client.computedAttributeCache.findUnique({
        where: {
          tenantId_identifierType_identifierValue: {
            tenantId,
            identifierType: identifier.type,
            identifierValue: identifier.value,
          },
        },
      });
      return row === null ? null : toDomain(row);
    });
  }

  /** ADR-0060: `expectedVersion` (when given) makes this a compare-and-swap write, the same
   * `updateMany` + `count === 0` ⇒ `ConcurrencyError` idiom D-042 already establishes for ~30 other
   * Prisma repositories on this platform (e.g. `PrismaWishlistRepository.save`). `0`
   * (`INITIAL_ATTRIBUTE_VERSION`) is the sentinel for "no row must exist yet", handled as a plain
   * `create` racing on the identifier's own unique key — identical to `PrismaWishlistRepository`'s
   * own `version === 0` branch, including that branch's accepted limitation: a unique-constraint
   * violation there surfaces as a raw Prisma error, not a typed `ConcurrencyError` (no service-layer
   * Prisma adapter on this platform catches `P2002` — see ADR-0060 §Decision 5 / §Alternatives). */
  async saveCurrent(
    attribute: ComputedAttribute,
    tenantId: string,
    expectedVersion?: number,
    tx?: unknown,
  ): Promise<void> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const where = {
      tenantId_identifierType_identifierValue: {
        tenantId,
        identifierType: attribute.identifierType,
        identifierValue: attribute.identifierValue,
      },
    };
    const data = {
      attributes: attributesToJson(attribute.attributes),
      version: attribute.version,
      updatedAt: new Date(attribute.updatedAt),
    };

    if (expectedVersion === undefined) {
      await client.computedAttributeCache.upsert({
        where,
        create: {
          id: this.deps.idGenerator.generate(),
          tenantId,
          identifierType: attribute.identifierType,
          identifierValue: attribute.identifierValue,
          ...data,
        },
        update: data,
      });
      return;
    }

    if (expectedVersion === INITIAL_ATTRIBUTE_VERSION) {
      await client.computedAttributeCache.create({
        data: {
          id: this.deps.idGenerator.generate(),
          tenantId,
          identifierType: attribute.identifierType,
          identifierValue: attribute.identifierValue,
          ...data,
        },
      });
      return;
    }

    const updated = await client.computedAttributeCache.updateMany({
      where: {
        tenantId,
        identifierType: attribute.identifierType,
        identifierValue: attribute.identifierValue,
        version: expectedVersion,
      },
      data,
    });
    if (updated.count === 0) {
      throw new ConcurrencyError(
        `AttributeStore CAS conflict for ${attribute.identifierType}:${attribute.identifierValue} (expected version ${expectedVersion})`,
      );
    }
  }

  async listIdentifiers(tenantId: string, tx?: unknown): Promise<readonly IdentifierRef[]> {
    return readScoped(this.deps.prisma, tenantId, tx, async (client) => {
      const rows = await client.computedAttributeCache.findMany({
        where: { tenantId },
        select: { identifierType: true, identifierValue: true },
      });
      return rows.map((row) => ({
        type: row.identifierType as IdentifierType,
        value: row.identifierValue,
      }));
    });
  }
}
