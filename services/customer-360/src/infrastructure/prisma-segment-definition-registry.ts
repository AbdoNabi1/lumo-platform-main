import type { Database, Prisma, TransactionClient } from "@platform/db";
import type { DomainEvent } from "@platform/domain";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { RuleSet } from "@platform/rules";
import { ConcurrencyError } from "@platform/utils";
import {
  INITIAL_SEGMENT_DEFINITION_VERSION,
  type SegmentDefinition,
} from "../ports/segment-definition";
import type { SegmentDefinitionRegistry } from "../ports/segment-definition-registry";

export interface PrismaSegmentDefinitionRegistryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  readonly idGenerator: { generate(): string };
  readonly tenantId: string;
}

interface DefinitionRow {
  readonly segmentId: string;
  readonly name: string;
  readonly description: string | null;
  readonly version: number;
  readonly ruleSet: unknown;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function toDomain(row: DefinitionRow): SegmentDefinition {
  return {
    id: row.segmentId,
    name: row.name,
    description: row.description ?? undefined,
    version: row.version,
    ruleSet: row.ruleSet as RuleSet<boolean>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Production `SegmentDefinitionRegistry` on the `customer_360` schema. Unlike
 * `PrismaAttributeDefinitionRegistry` (read-only, seed-script-populated), this registry is
 * **read-write** and CAS-guarded (ADR-0060/D-042) — `CreateSegment`/`UpdateSegment`/`DeleteSegment`
 * are a real authoring lifecycle. `ruleSet` is stored as `Json` — already plain, JSON-serializable
 * data by construction (ADR-0053), so no bespoke rule-set (de)serializer is written here.
 */
export class PrismaSegmentDefinitionRegistry implements SegmentDefinitionRegistry {
  private readonly deps: PrismaSegmentDefinitionRegistryDeps;

  constructor(deps: PrismaSegmentDefinitionRegistryDeps) {
    this.deps = deps;
  }

  async list(tx?: unknown): Promise<readonly SegmentDefinition[]> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const rows = await client.segmentDefinition.findMany({
      where: { tenantId: this.deps.tenantId },
    });
    return rows.map(toDomain);
  }

  async getById(id: string, tx?: unknown): Promise<SegmentDefinition | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.segmentDefinition.findUnique({
      where: { tenantId_segmentId: { tenantId: this.deps.tenantId, segmentId: id } },
    });
    return row === null ? null : toDomain(row);
  }

  /** ADR-0060: same `updateMany` + `count === 0` ⇒ `ConcurrencyError` / `expectedVersion === 0` ⇒
   * plain `create` / `expectedVersion === undefined` ⇒ unconditional upsert idiom as
   * `PrismaAttributeStore.saveCurrent`. `tx` is optional for the row write alone (mirrors
   * `AttributeStore.saveCurrent`, and keeps this adapter passable to the same
   * `runSegmentDefinitionRegistryContractTests` suite the in-memory adapter runs, which exercises
   * `save`/`delete` with no transaction at all); but `event` — written to the outbox in the same unit
   * of work, since there is no separate history store for definitions to publish through instead —
   * requires one, the same atomicity `PrismaAttributeHistoryStore.append`'s `requireTx` protects: a
   * row write and its paired event write must commit together or not at all. */
  async save(
    definition: SegmentDefinition,
    expectedVersion?: number,
    event?: DomainEvent,
    tx?: unknown,
  ): Promise<void> {
    const client = this.resolveClient(event, tx);
    const where = {
      tenantId_segmentId: { tenantId: this.deps.tenantId, segmentId: definition.id },
    };
    const data = {
      name: definition.name,
      description: definition.description ?? null,
      version: definition.version,
      ruleSet: asInputJson(definition.ruleSet),
      updatedAt: new Date(definition.updatedAt),
    };

    if (expectedVersion === undefined) {
      await client.segmentDefinition.upsert({
        where,
        create: {
          id: this.deps.idGenerator.generate(),
          tenantId: this.deps.tenantId,
          segmentId: definition.id,
          createdAt: new Date(definition.createdAt),
          ...data,
        },
        update: data,
      });
    } else if (expectedVersion === INITIAL_SEGMENT_DEFINITION_VERSION) {
      await client.segmentDefinition.create({
        data: {
          id: this.deps.idGenerator.generate(),
          tenantId: this.deps.tenantId,
          segmentId: definition.id,
          createdAt: new Date(definition.createdAt),
          ...data,
        },
      });
    } else {
      const updated = await client.segmentDefinition.updateMany({
        where: { tenantId: this.deps.tenantId, segmentId: definition.id, version: expectedVersion },
        data,
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `SegmentDefinitionRegistry CAS conflict for ${definition.id} (expected version ${expectedVersion})`,
        );
      }
    }

    if (event !== undefined) {
      await this.deps.outbox.write([event], this.deps.context, client);
    }
  }

  /** CAS delete — `deleteMany` + `count === 0` ⇒ `ConcurrencyError`, covering both "no such
   * definition" and "stale expectedVersion" uniformly (no extra read to disambiguate, matching every
   * other D-042 adapter's own `updateMany` branch). Never cascades into `SegmentMembership`/
   * `SegmentHistory` rows — those live in separate tables this method never touches. */
  async delete(
    id: string,
    expectedVersion: number,
    event?: DomainEvent,
    tx?: unknown,
  ): Promise<void> {
    const client = this.resolveClient(event, tx);
    const deleted = await client.segmentDefinition.deleteMany({
      where: { tenantId: this.deps.tenantId, segmentId: id, version: expectedVersion },
    });
    if (deleted.count === 0) {
      throw new ConcurrencyError(
        `SegmentDefinitionRegistry delete conflict for ${id} (expected version ${expectedVersion})`,
      );
    }
    if (event !== undefined) {
      await this.deps.outbox.write([event], this.deps.context, client);
    }
  }

  /** `tx` is required only when `event` is supplied — a bare row write may run directly against
   * `this.deps.prisma` (mirrors `AttributeStore.saveCurrent`'s own optional-`tx` shape), but a row
   * write paired with an event write must share one transaction (mirrors
   * `PrismaAttributeHistoryStore.append`'s `requireTx`) so the two can never commit independently. */
  private resolveClient(event: DomainEvent | undefined, tx: unknown): TransactionClient | Database {
    if (event === undefined) {
      return (tx as TransactionClient | undefined) ?? this.deps.prisma;
    }
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaSegmentDefinitionRegistry.save/delete requires the unit of work's transaction client (ADR-0003) when an event is supplied — the row write and the outbox write must commit together.",
      );
    }
    return tx as TransactionClient;
  }
}
