import type { EventContext, OutboxWriter } from "@platform/messaging";
import type {
  MembershipRepository,
  OrganizationRepository,
  UserRepository,
} from "../domain/access-repositories";
import type { Membership } from "../domain/membership";
import type { Organization } from "../domain/organization";
import type { User } from "../domain/user";

export interface InMemoryAccessRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `UserRepository`. Persists the aggregate and writes its events to the outbox on save. */
export class InMemoryUserRepository implements UserRepository {
  private readonly store = new Map<string, User>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryAccessRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(user: User, tx?: unknown): Promise<void> {
    this.store.set(user.id.toString(), user);
    await this.outbox.write(
      user.pullDomainEvents(),
      { ...this.context, tenantId: user.tenantId },
      tx,
    );
  }

  async findById(id: string, tenantId: string): Promise<User | null> {
    const user = this.store.get(id);
    return user !== undefined && user.tenantId === tenantId ? user : null;
  }

  async findByEmail(email: string, tenantId: string): Promise<User | null> {
    for (const user of this.store.values()) {
      if (user.tenantId === tenantId && user.email.value === email) {
        return user;
      }
    }
    return null;
  }
}

/** In-memory `OrganizationRepository`. Persists the aggregate and writes its events to the outbox on save. */
export class InMemoryOrganizationRepository implements OrganizationRepository {
  private readonly store = new Map<string, Organization>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryAccessRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(organization: Organization, tx?: unknown): Promise<void> {
    this.store.set(organization.id.toString(), organization);
    await this.outbox.write(
      organization.pullDomainEvents(),
      { ...this.context, tenantId: organization.tenantId },
      tx,
    );
  }

  async findById(id: string, tenantId: string): Promise<Organization | null> {
    const organization = this.store.get(id);
    return organization !== undefined && organization.tenantId === tenantId ? organization : null;
  }

  async findBySlug(slug: string, tenantId: string): Promise<Organization | null> {
    for (const organization of this.store.values()) {
      if (organization.tenantId === tenantId && organization.slug.value === slug) {
        return organization;
      }
    }
    return null;
  }
}

/** In-memory `MembershipRepository`. Persists the aggregate and writes its events to the outbox on save. */
export class InMemoryMembershipRepository implements MembershipRepository {
  private readonly store = new Map<string, Membership>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryAccessRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(membership: Membership, tx?: unknown): Promise<void> {
    this.store.set(membership.id.toString(), membership);
    await this.outbox.write(
      membership.pullDomainEvents(),
      { ...this.context, tenantId: membership.tenantId },
      tx,
    );
  }

  async findById(id: string, tenantId: string): Promise<Membership | null> {
    const membership = this.store.get(id);
    return membership !== undefined && membership.tenantId === tenantId ? membership : null;
  }

  async findByUserAndOrganization(
    userId: string,
    organizationId: string,
    tenantId: string,
  ): Promise<Membership | null> {
    for (const membership of this.store.values()) {
      if (
        membership.tenantId === tenantId &&
        membership.userId === userId &&
        membership.organizationId === organizationId
      ) {
        return membership;
      }
    }
    return null;
  }
}
