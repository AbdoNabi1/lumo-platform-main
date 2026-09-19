import type {
  IdentityMembershipRecord,
  IdentityOrganizationRecord,
  IdentityProjectionStore,
  IdentityUserRecord,
} from "../application/ports";
import { ScopedMap } from "./in-memory-scoped-map";

/**
 * In-memory {@link IdentityProjectionStore} (offline/tests) — the read projection of Identity's
 * users/organizations/memberships Security resolves against (H-2). Last-writer-wins by `occurredAt`, so
 * redelivered / out-of-order events converge and never regress a newer fact. Not a fake: it runs the
 * real projection/LWW logic; the Prisma store implements the same contract for production.
 */
export class InMemoryIdentityProjectionStore implements IdentityProjectionStore {
  private readonly users = new ScopedMap<IdentityUserRecord>();
  private readonly orgs = new ScopedMap<IdentityOrganizationRecord>();
  private readonly memberships = new ScopedMap<IdentityMembershipRecord>();

  async upsertUser(record: IdentityUserRecord, tenantId: string): Promise<void> {
    const existing = this.users.get(tenantId, record.userId);
    if (existing !== undefined && existing.occurredAt > record.occurredAt) return; // strictly-older ⇒ drop
    this.users.set(tenantId, record.userId, record);
  }

  async setUserStatus(
    userId: string,
    status: IdentityUserRecord["status"],
    occurredAt: string,
    tenantId: string,
  ): Promise<void> {
    const existing = this.users.get(tenantId, userId);
    if (existing !== undefined && existing.occurredAt > occurredAt) return;
    this.users.set(tenantId, userId, {
      userId,
      userTenant: existing?.userTenant ?? null,
      status,
      occurredAt,
    });
  }

  async getUser(userId: string, tenantId: string): Promise<IdentityUserRecord | null> {
    return this.users.get(tenantId, userId) ?? null;
  }

  async upsertOrganization(record: IdentityOrganizationRecord, tenantId: string): Promise<void> {
    const existing = this.orgs.get(tenantId, record.organizationId);
    if (existing !== undefined && existing.occurredAt > record.occurredAt) return;
    this.orgs.set(tenantId, record.organizationId, record);
  }

  async getOrganization(
    organizationId: string,
    tenantId: string,
  ): Promise<IdentityOrganizationRecord | null> {
    return this.orgs.get(tenantId, organizationId) ?? null;
  }

  async upsertMembership(record: IdentityMembershipRecord, tenantId: string): Promise<void> {
    const existing = this.memberships.get(tenantId, record.membershipId);
    if (existing !== undefined && existing.occurredAt > record.occurredAt) return;
    this.memberships.set(tenantId, record.membershipId, record);
  }

  async setMembershipRole(
    membershipId: string,
    role: string,
    occurredAt: string,
    tenantId: string,
  ): Promise<void> {
    const existing = this.memberships.get(tenantId, membershipId);
    if (existing === undefined) return; // create precedes role-change per aggregate ordering
    if (existing.occurredAt > occurredAt) return;
    this.memberships.set(tenantId, membershipId, { ...existing, role, occurredAt });
  }

  async listMembershipsByUser(
    userId: string,
    tenantId: string,
  ): Promise<readonly IdentityMembershipRecord[]> {
    return this.memberships.values(tenantId).filter((m) => m.userId === userId);
  }
}
