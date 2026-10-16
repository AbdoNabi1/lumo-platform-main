import { bucket, type TenantSeed } from "./tenant-seed";
import type { AttributeDefinitionRegistry } from "../ports/attribute-definition-registry";
import type { ComputedAttributeDefinition } from "../ports/computed-attribute-definition";

/**
 * In-memory adapter — dev/test only. Seeded once at construction (definitions are authored
 * configuration, not something this engine mutates at runtime — no `save`/`upsert` method exists on
 * `AttributeDefinitionRegistry` for exactly that reason; Phase 6.4 does not build a definition-authoring
 * admin surface, see the report's deferred-work section).
 */
export class InMemoryAttributeDefinitionRegistry implements AttributeDefinitionRegistry {
  private readonly tenants = new Map<string, Map<string, ComputedAttributeDefinition>>();

  constructor(seed?: TenantSeed<ComputedAttributeDefinition>) {
    if (seed !== undefined) {
      const definitions = this.definitions(seed.tenantId);
      for (const definition of seed.definitions) definitions.set(definition.id, definition);
    }
  }

  private definitions(tenantId: string): Map<string, ComputedAttributeDefinition> {
    return bucket(this.tenants, tenantId, () => new Map<string, ComputedAttributeDefinition>());
  }

  async list(tenantId: string): Promise<readonly ComputedAttributeDefinition[]> {
    return [...this.definitions(tenantId).values()];
  }

  async getById(id: string, tenantId: string): Promise<ComputedAttributeDefinition | null> {
    return this.definitions(tenantId).get(id) ?? null;
  }
}
