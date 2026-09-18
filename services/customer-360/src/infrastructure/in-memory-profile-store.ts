import type { IdentifierType } from "@platform/tracking";
import type { CustomerProfile } from "../domain/customer-profile";
import type { IdentifierRef } from "../ports/identity-decision";
import type { ProfileStore } from "../ports/profile-store";
import { bucket } from "./tenant-seed";

function key(identifier: IdentifierRef): string {
  return `${identifier.type}:${identifier.value}`;
}

/** In-memory adapter — dev/test only. No outbox dependency: unlike the append-only ledgers, this
 * store never publishes an event of its own (see `ProfileStore`'s doc — the event always travels
 * with the paired `ProfileHistoryStore.append` call instead, so it is published exactly once). */
export class InMemoryProfileStore implements ProfileStore {
  private readonly tenants = new Map<string, Map<string, CustomerProfile>>();

  private current(tenantId: string): Map<string, CustomerProfile> {
    return bucket(this.tenants, tenantId, () => new Map<string, CustomerProfile>());
  }

  async getCurrent(identifier: IdentifierRef, tenantId: string): Promise<CustomerProfile | null> {
    return this.current(tenantId).get(key(identifier)) ?? null;
  }

  async saveCurrent(profile: CustomerProfile, tenantId: string): Promise<void> {
    this.current(tenantId).set(
      key({ type: profile.identifierType as IdentifierType, value: profile.identifierValue }),
      profile,
    );
  }

  async listIdentifiers(tenantId: string): Promise<readonly IdentifierRef[]> {
    return [...this.current(tenantId).values()].map((profile) => ({
      type: profile.identifierType as IdentifierType,
      value: profile.identifierValue,
    }));
  }
}
