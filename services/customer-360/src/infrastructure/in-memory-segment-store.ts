import type { IdentifierType } from "@platform/tracking";
import { ConcurrencyError } from "@platform/utils";
import { INITIAL_SEGMENT_VERSION } from "../domain/segment-version";
import type { SegmentMembership, SegmentMembershipStatus } from "../domain/segment-membership";
import type { IdentifierRef } from "../ports/identity-decision";
import type { SegmentStore } from "../ports/segment-store";
import { bucket } from "./tenant-seed";

function key(identifier: IdentifierRef, segmentId: string): string {
  return `${identifier.type}:${identifier.value}:${segmentId}`;
}

/** In-memory adapter — dev/test only. No outbox dependency, same reasoning `InMemoryAttributeStore`
 * documents: this store never publishes an event of its own — the event always travels with the
 * paired `SegmentHistoryStore.append` call instead, so it is published exactly once. Keyed by
 * `(identifier, segmentId)`, one row per pair — see `ports/segment-store.ts`'s module doc for why. */
export class InMemorySegmentStore implements SegmentStore {
  private readonly tenants = new Map<string, Map<string, SegmentMembership>>();

  private current(tenantId: string): Map<string, SegmentMembership> {
    return bucket(this.tenants, tenantId, () => new Map<string, SegmentMembership>());
  }

  async getCurrent(
    identifier: IdentifierRef,
    segmentId: string,
    tenantId: string,
  ): Promise<SegmentMembership | null> {
    return this.current(tenantId).get(key(identifier, segmentId)) ?? null;
  }

  /** ADR-0060: `expectedVersion` (when given) guards the write against whatever is currently stored.
   * A `Map` read-check-write is trivially atomic here — no `await` sits between the check and the
   * `.set()`, so no interleaving from another concurrent call can land between them. */
  async saveCurrent(
    membership: SegmentMembership,
    tenantId: string,
    expectedVersion?: number,
  ): Promise<void> {
    const current = this.current(tenantId);
    const k = key(
      { type: membership.identifierType as IdentifierType, value: membership.identifierValue },
      membership.segmentId,
    );
    if (expectedVersion !== undefined) {
      const actual = current.get(k)?.version ?? INITIAL_SEGMENT_VERSION;
      if (actual !== expectedVersion) {
        throw new ConcurrencyError(
          `SegmentStore CAS conflict for ${k}: expected version ${expectedVersion}, found ${actual}`,
        );
      }
    }
    current.set(k, membership);
  }

  async listForIdentifier(
    identifier: IdentifierRef,
    tenantId: string,
  ): Promise<readonly SegmentMembership[]> {
    return [...this.current(tenantId).values()].filter(
      (m) => m.identifierType === identifier.type && m.identifierValue === identifier.value,
    );
  }

  async listMembers(
    segmentId: string,
    tenantId: string,
    status: SegmentMembershipStatus = "entered",
  ): Promise<readonly SegmentMembership[]> {
    return [...this.current(tenantId).values()].filter(
      (m) => m.segmentId === segmentId && m.status === status,
    );
  }

  async listIdentifiers(
    tenantId: string,
  ): Promise<readonly { identifier: IdentifierRef; segmentId: string }[]> {
    return [...this.current(tenantId).values()].map((m) => ({
      identifier: { type: m.identifierType as IdentifierType, value: m.identifierValue },
      segmentId: m.segmentId,
    }));
  }
}
