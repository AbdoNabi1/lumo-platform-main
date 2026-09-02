import type { DomainEvent } from "@platform/domain";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import {
  INITIAL_SEGMENT_DEFINITION_VERSION,
  type SegmentDefinition,
} from "../ports/segment-definition";
import type { SegmentDefinitionRegistry } from "../ports/segment-definition-registry";

export interface InMemorySegmentDefinitionRegistryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory adapter — dev/test only. Unlike `InMemoryAttributeDefinitionRegistry` (seeded once, never
 * mutated), this registry is read-write and CAS-guarded (ADR-0060/D-042) — `SegmentDefinitionRegistry`
 * has a real `CreateSegment`/`UpdateSegment`/`DeleteSegment` authoring lifecycle. May still be
 * pre-seeded via the constructor for tests/composition, exactly like the read-only registry.
 */
export class InMemorySegmentDefinitionRegistry implements SegmentDefinitionRegistry {
  private readonly definitions: Map<string, SegmentDefinition>;
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(
    deps: InMemorySegmentDefinitionRegistryDeps,
    seed: readonly SegmentDefinition[] = [],
  ) {
    this.outbox = deps.outbox;
    this.context = deps.context;
    this.definitions = new Map(seed.map((definition) => [definition.id, definition]));
  }

  async list(): Promise<readonly SegmentDefinition[]> {
    return [...this.definitions.values()];
  }

  async getById(id: string): Promise<SegmentDefinition | null> {
    return this.definitions.get(id) ?? null;
  }

  /** ADR-0060: `expectedVersion` (when given) guards the write against whatever is currently stored —
   * same `Map` read-check-write atomicity `InMemorySegmentStore.saveCurrent` documents. */
  async save(
    definition: SegmentDefinition,
    expectedVersion?: number,
    event?: DomainEvent,
    tx?: unknown,
  ): Promise<void> {
    if (expectedVersion !== undefined) {
      const actual =
        this.definitions.get(definition.id)?.version ?? INITIAL_SEGMENT_DEFINITION_VERSION;
      if (actual !== expectedVersion) {
        throw new ConcurrencyError(
          `SegmentDefinitionRegistry CAS conflict for ${definition.id}: expected version ${expectedVersion}, found ${actual}`,
        );
      }
    }
    this.definitions.set(definition.id, definition);
    if (event !== undefined) {
      await this.outbox.write([event], this.context, tx);
    }
  }

  async delete(
    id: string,
    expectedVersion: number,
    event?: DomainEvent,
    tx?: unknown,
  ): Promise<void> {
    const actual = this.definitions.get(id)?.version;
    if (actual === undefined) {
      throw new ConcurrencyError(
        `SegmentDefinitionRegistry delete conflict for ${id}: no definition found`,
      );
    }
    if (actual !== expectedVersion) {
      throw new ConcurrencyError(
        `SegmentDefinitionRegistry CAS conflict for ${id}: expected version ${expectedVersion}, found ${actual}`,
      );
    }
    this.definitions.delete(id);
    if (event !== undefined) {
      await this.outbox.write([event], this.context, tx);
    }
  }
}
