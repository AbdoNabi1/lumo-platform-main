import type { Database, Prisma } from "@platform/db";
import type { RuleSet } from "@platform/rules";
import type { AttributeValue } from "../domain/attribute-value";
import type { AttributeDefinitionRegistry } from "../ports/attribute-definition-registry";
import type { ComputedAttributeDefinition } from "../ports/computed-attribute-definition";
import { readScoped } from "./scoped-read";

export interface PrismaAttributeDefinitionRegistryDeps {
  readonly prisma: Database;
}

interface DefinitionRow {
  readonly definitionId: string;
  readonly version: number;
  readonly ruleSet: unknown;
  readonly dependencies: unknown;
  readonly description: string | null;
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function toDomain(row: DefinitionRow): ComputedAttributeDefinition {
  return {
    id: row.definitionId,
    version: row.version,
    ruleSet: row.ruleSet as RuleSet<AttributeValue>,
    dependencies: row.dependencies as readonly string[],
    description: row.description ?? undefined,
  };
}

/**
 * Production `AttributeDefinitionRegistry` on the `customer_360` schema. `ruleSet`/`dependencies` are
 * stored as `Json` — a `RuleSet<AttributeValue>` is already plain, JSON-serializable data by
 * construction (ADR-0053: "expressions are data, never code"), so this store never deserializes into
 * anything richer than the same plain object `@platform/rules`' `evaluateRuleSet` already accepts; no
 * bespoke rule-set (de)serializer is written here or anywhere in this package.
 *
 * No `save`/`upsert` method — matches `AttributeDefinitionRegistry`'s own port contract exactly:
 * Phase 6.4 builds the read side a definition-authoring surface would need, not that surface itself
 * (see the report's deferred-work section). Rows are expected to be seeded by migration/seed script,
 * the same maturity level the other three engines' own Prisma wiring already accepts.
 */
export class PrismaAttributeDefinitionRegistry implements AttributeDefinitionRegistry {
  private readonly deps: PrismaAttributeDefinitionRegistryDeps;

  constructor(deps: PrismaAttributeDefinitionRegistryDeps) {
    this.deps = deps;
  }

  async list(tenantId: string, tx?: unknown): Promise<readonly ComputedAttributeDefinition[]> {
    return readScoped(this.deps.prisma, tenantId, tx, async (client) => {
      const rows = await client.computedAttributeDefinition.findMany({
        where: { tenantId },
      });
      return rows.map(toDomain);
    });
  }

  async getById(
    id: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<ComputedAttributeDefinition | null> {
    return readScoped(this.deps.prisma, tenantId, tx, async (client) => {
      const row = await client.computedAttributeDefinition.findUnique({
        where: { tenantId_definitionId: { tenantId, definitionId: id } },
      });
      return row === null ? null : toDomain(row);
    });
  }
}

/** Serializes a `ComputedAttributeDefinition` for a seed/migration script to write — the write half
 * `AttributeDefinitionRegistry`'s read-only port deliberately does not expose (see the class doc). */
export function toDefinitionRow(
  definition: ComputedAttributeDefinition,
  tenantId: string,
  id: string,
): {
  readonly id: string;
  readonly tenantId: string;
  readonly definitionId: string;
  readonly version: number;
  readonly ruleSet: Prisma.InputJsonValue;
  readonly dependencies: Prisma.InputJsonValue;
  readonly description: string | null;
} {
  return {
    id,
    tenantId,
    definitionId: definition.id,
    version: definition.version,
    ruleSet: asInputJson(definition.ruleSet),
    dependencies: asInputJson(definition.dependencies),
    description: definition.description ?? null,
  };
}
