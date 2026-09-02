import type { IdentifierType } from "@platform/tracking";
import type { CustomerProfile } from "../domain/customer-profile";
import type { IdentifierRef } from "../ports/identity-decision";
import type { ProfileStore } from "../ports/profile-store";

function key(identifier: IdentifierRef): string {
  return `${identifier.type}:${identifier.value}`;
}

/** In-memory adapter — dev/test only. No outbox dependency: unlike the append-only ledgers, this
 * store never publishes an event of its own (see `ProfileStore`'s doc — the event always travels
 * with the paired `ProfileHistoryStore.append` call instead, so it is published exactly once). */
export class InMemoryProfileStore implements ProfileStore {
  private readonly current = new Map<string, CustomerProfile>();

  async getCurrent(identifier: IdentifierRef): Promise<CustomerProfile | null> {
    return this.current.get(key(identifier)) ?? null;
  }

  async saveCurrent(profile: CustomerProfile): Promise<void> {
    this.current.set(
      key({ type: profile.identifierType as IdentifierType, value: profile.identifierValue }),
      profile,
    );
  }

  async listIdentifiers(): Promise<readonly IdentifierRef[]> {
    return [...this.current.values()].map((profile) => ({
      type: profile.identifierType as IdentifierType,
      value: profile.identifierValue,
    }));
  }
}
