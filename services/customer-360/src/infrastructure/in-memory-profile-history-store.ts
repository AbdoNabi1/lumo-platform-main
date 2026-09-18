import type { DomainEvent } from "@platform/domain";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { ProfileSnapshot } from "../domain/profile-snapshot";
import type { IdentifierRef } from "../ports/identity-decision";
import type { ProfileHistoryStore } from "../ports/profile-history-store";
import { bucket } from "./tenant-seed";

export interface InMemoryProfileHistoryStoreDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory adapter — dev/test only. Same outbox-write-on-append shape as
 * `InMemoryIdentityDecisionStore` (same package, same convention). */
export class InMemoryProfileHistoryStore implements ProfileHistoryStore {
  private readonly tenants = new Map<string, ProfileSnapshot[]>();

  private snapshots(tenantId: string): ProfileSnapshot[] {
    return bucket(this.tenants, tenantId, () => []);
  }
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryProfileHistoryStoreDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async append(
    snapshot: ProfileSnapshot,
    event: DomainEvent,
    tenantId: string,
    tx?: unknown,
  ): Promise<void> {
    this.snapshots(tenantId).push(snapshot);
    await this.outbox.write([event], this.context, tx);
  }

  async listFor(identifier: IdentifierRef, tenantId: string): Promise<readonly ProfileSnapshot[]> {
    return this.snapshots(tenantId).filter(
      (s) => s.identifierType === identifier.type && s.identifierValue === identifier.value,
    );
  }

  async latestFor(identifier: IdentifierRef, tenantId: string): Promise<ProfileSnapshot | null> {
    const rows = await this.listFor(identifier, tenantId);
    return rows.at(-1) ?? null;
  }
}
