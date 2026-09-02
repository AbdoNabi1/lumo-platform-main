import type { AttributeDefinitionRegistry } from "../ports/attribute-definition-registry";
import type { ComputedAttributeDefinition } from "../ports/computed-attribute-definition";

/**
 * In-memory adapter — dev/test only. Seeded once at construction (definitions are authored
 * configuration, not something this engine mutates at runtime — no `save`/`upsert` method exists on
 * `AttributeDefinitionRegistry` for exactly that reason; Phase 6.4 does not build a definition-authoring
 * admin surface, see the report's deferred-work section).
 */
export class InMemoryAttributeDefinitionRegistry implements AttributeDefinitionRegistry {
  private readonly definitions: Map<string, ComputedAttributeDefinition>;

  constructor(definitions: readonly ComputedAttributeDefinition[] = []) {
    this.definitions = new Map(definitions.map((definition) => [definition.id, definition]));
  }

  async list(): Promise<readonly ComputedAttributeDefinition[]> {
    return [...this.definitions.values()];
  }

  async getById(id: string): Promise<ComputedAttributeDefinition | null> {
    return this.definitions.get(id) ?? null;
  }
}
