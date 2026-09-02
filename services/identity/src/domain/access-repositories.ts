import type { Membership } from "./membership";
import type { Organization } from "./organization";
import type { User } from "./user";

/** Persistence port for {@link User}. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface UserRepository {
  save(user: User, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<User | null>;
  /** Looks up a user by their email within a tenant — used to enforce per-tenant uniqueness. */
  findByEmail(email: string, tenantId: string, tx?: unknown): Promise<User | null>;
}

/** Persistence port for {@link Organization}. */
export interface OrganizationRepository {
  save(organization: Organization, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Organization | null>;
  /** Looks up an organization by its slug within a tenant — used to enforce per-tenant uniqueness. */
  findBySlug(slug: string, tenantId: string, tx?: unknown): Promise<Organization | null>;
}

/** Persistence port for {@link Membership}. */
export interface MembershipRepository {
  save(membership: Membership, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Membership | null>;
  /** Looks up an existing membership for a (user, organization) pair — used to enforce uniqueness. */
  findByUserAndOrganization(
    userId: string,
    organizationId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<Membership | null>;
}
