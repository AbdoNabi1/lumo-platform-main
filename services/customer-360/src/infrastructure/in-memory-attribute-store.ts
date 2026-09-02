import type { IdentifierType } from "@platform/tracking";
import { ConcurrencyError } from "@platform/utils";
import { INITIAL_ATTRIBUTE_VERSION } from "../domain/attribute-version";
import type { ComputedAttribute } from "../domain/computed-attribute";
import type { AttributeStore } from "../ports/attribute-store";
import type { IdentifierRef } from "../ports/identity-decision";

function key(identifier: IdentifierRef): string {
  return `${identifier.type}:${identifier.value}`;
}

/** In-memory adapter — dev/test only. No outbox dependency, same reasoning `InMemoryProfileStore`
 * documents: this store never publishes an event of its own — the event always travels with the
 * paired `AttributeHistoryStore.append` call instead, so it is published exactly once. */
export class InMemoryAttributeStore implements AttributeStore {
  private readonly current = new Map<string, ComputedAttribute>();

  async getCurrent(identifier: IdentifierRef): Promise<ComputedAttribute | null> {
    return this.current.get(key(identifier)) ?? null;
  }

  /** ADR-0060: `expectedVersion` (when given) guards the write against whatever is currently
   * stored. A `Map` read-check-write is trivially atomic here — there is no `await` between the
   * check and the `.set()`, so no interleaving from another concurrent call can land between them,
   * even though the two calls' surrounding `async` methods do interleave at their own `await`
   * points (that interleaving is exactly the race this guard exists to catch). */
  async saveCurrent(attribute: ComputedAttribute, expectedVersion?: number): Promise<void> {
    const k = key({
      type: attribute.identifierType as IdentifierType,
      value: attribute.identifierValue,
    });
    if (expectedVersion !== undefined) {
      const actual = this.current.get(k)?.version ?? INITIAL_ATTRIBUTE_VERSION;
      if (actual !== expectedVersion) {
        throw new ConcurrencyError(
          `AttributeStore CAS conflict for ${k}: expected version ${expectedVersion}, found ${actual}`,
        );
      }
    }
    this.current.set(k, attribute);
  }

  async listIdentifiers(): Promise<readonly IdentifierRef[]> {
    return [...this.current.values()].map((attribute) => ({
      type: attribute.identifierType as IdentifierType,
      value: attribute.identifierValue,
    }));
  }
}
