import type {
  IdentityMembershipRecord,
  IdentityOrganizationRecord,
  IdentityProjectionStore,
  IdentityUserRecord,
} from "../application/ports";

/**
 * In-memory {@link IdentityProjectionStore} (offline/tests) — the read projection of Identity's
 * users/organizations/memberships Security resolves against (H-2). Last-writer-wins by `occurredAt`, so
 * redelivered / out-of-order events converge and never regress a newer fact. Not a fake: it runs the
 * real projection/LWW logic; the Prisma store implements the same contract for production.
 */
export class InMemoryIdentityProjectionStore implements IdentityProjectionStore {
  private readonly users = new Map<string, IdentityUserRecord>();
  private readonly orgs = new Map<string, IdentityOrganizationRecord>();
  private readonly memberships = new Map<string, IdentityMembershipRecord>();

  async upsertUser(record: IdentityUserRecord): Promise<void> {
    const existing = this.users.get(record.userId);
    if (existing !== undefined && existing.occurredAt > record.occurredAt) return; // strictly-older ⇒ drop
    this.users.set(record.userId, record);
  }

  async setUserStatus(
    userId: string,
    status: IdentityUserRecord["status"],
    occurredAt: string,
  ): Promise<void> {
    const existing = this.users.get(userId);
    if (existing !== undefined && existing.occurredAt > occurredAt) return;
    this.users.set(userId, {
      userId,
      userTenant: existing?.userTenant ?? null,
      status,
      occurredAt,
    });
  }

  async getUser(userId: string): Promise<IdentityUserRecord | null> {
    return this.users.get(userId) ?? null;
  }

  async upsertOrganization(record: IdentityOrganizationRecord): Promise<void> {
    const existing = this.orgs.get(record.organizationId);
    if (existing !== undefined && existing.occurredAt > record.occurredAt) return;
    this.orgs.set(record.organizationId, record);
  }

  async getOrganization(organizationId: string): Promise<IdentityOrganizationRecord | null> {
    return this.orgs.get(organizationId) ?? null;
  }

  async upsertMembership(record: IdentityMembershipRecord): Promise<void> {
    const existing = this.memberships.get(record.membershipId);
    if (existing !== undefined && existing.occurredAt > record.occurredAt) return;
    this.memberships.set(record.membershipId, record);
  }

  async setMembershipRole(membershipId: string, role: string, occurredAt: string): Promise<void> {
    const existing = this.memberships.get(membershipId);
    if (existing === undefined) return; // create precedes role-change per aggregate ordering
    if (existing.occurredAt > occurredAt) return;
    this.memberships.set(membershipId, { ...existing, role, occurredAt });
  }

  async listMembershipsByUser(userId: string): Promise<readonly IdentityMembershipRecord[]> {
    return [...this.memberships.values()].filter((m) => m.userId === userId);
  }
}
