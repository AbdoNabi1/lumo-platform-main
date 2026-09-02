import type { IntegrationEvent } from "@platform/domain-events";
import type { EventHandler } from "@platform/messaging";
import type { Logger } from "@platform/utils";
import type { IdentityProjectionStore } from "../application/ports";

/**
 * Consumers that maintain Security's **Identity projection** (H-2 / G-SEC-4) — the read model behind
 * principal / membership / organization resolution. Identity **owns** Users/Organizations/Memberships and
 * emits them; these consumers project the already-published `identity.*` integration events into
 * Security's local copy. No ownership moves: Security never writes back and never re-derives identity
 * facts. Every handler is idempotent — the store is last-writer-wins by `occurredAt`, so redelivery /
 * out-of-order is a no-op, and Kafka per-aggregate ordering makes create precede status/role mutation.
 */

export interface IdentityUserCreatedPayload {
  readonly userId: string;
  readonly tenantId: string;
}
export class IdentityUserCreatedConsumer implements EventHandler<IdentityUserCreatedPayload> {
  readonly eventType = "identity.user.created";
  readonly eventVersion = 1;
  constructor(
    private readonly deps: { readonly store: IdentityProjectionStore; readonly logger: Logger },
  ) {}
  async handle(event: IntegrationEvent<IdentityUserCreatedPayload>): Promise<void> {
    await this.deps.store.upsertUser({
      userId: event.payload.userId,
      userTenant: event.payload.tenantId,
      status: "active",
      occurredAt: event.occurredAt,
    });
  }
}

export type IdentityUserDeactivatedPayload = { readonly userId: string };
export class IdentityUserDeactivatedConsumer implements EventHandler<IdentityUserDeactivatedPayload> {
  readonly eventType = "identity.user.deactivated";
  readonly eventVersion = 1;
  constructor(
    private readonly deps: { readonly store: IdentityProjectionStore; readonly logger: Logger },
  ) {}
  async handle(event: IntegrationEvent<IdentityUserDeactivatedPayload>): Promise<void> {
    await this.deps.store.setUserStatus(event.payload.userId, "deactivated", event.occurredAt);
  }
}

export interface IdentityOrganizationCreatedPayload {
  readonly organizationId: string;
  readonly slug: string;
  readonly tenantId: string;
}
export class IdentityOrganizationCreatedConsumer implements EventHandler<IdentityOrganizationCreatedPayload> {
  readonly eventType = "identity.organization.created";
  readonly eventVersion = 1;
  constructor(
    private readonly deps: { readonly store: IdentityProjectionStore; readonly logger: Logger },
  ) {}
  async handle(event: IntegrationEvent<IdentityOrganizationCreatedPayload>): Promise<void> {
    await this.deps.store.upsertOrganization({
      organizationId: event.payload.organizationId,
      slug: event.payload.slug,
      orgTenant: event.payload.tenantId,
      occurredAt: event.occurredAt,
    });
  }
}

export interface IdentityMembershipCreatedPayload {
  readonly membershipId: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly role: string;
}
export class IdentityMembershipCreatedConsumer implements EventHandler<IdentityMembershipCreatedPayload> {
  readonly eventType = "identity.membership.created";
  readonly eventVersion = 1;
  constructor(
    private readonly deps: { readonly store: IdentityProjectionStore; readonly logger: Logger },
  ) {}
  async handle(event: IntegrationEvent<IdentityMembershipCreatedPayload>): Promise<void> {
    await this.deps.store.upsertMembership({
      membershipId: event.payload.membershipId,
      userId: event.payload.userId,
      organizationId: event.payload.organizationId,
      role: event.payload.role,
      occurredAt: event.occurredAt,
    });
  }
}

export interface IdentityMembershipRoleChangedPayload {
  readonly membershipId: string;
  readonly role: string;
}
export class IdentityMembershipRoleChangedConsumer implements EventHandler<IdentityMembershipRoleChangedPayload> {
  readonly eventType = "identity.membership.role_changed";
  readonly eventVersion = 1;
  constructor(
    private readonly deps: { readonly store: IdentityProjectionStore; readonly logger: Logger },
  ) {}
  async handle(event: IntegrationEvent<IdentityMembershipRoleChangedPayload>): Promise<void> {
    await this.deps.store.setMembershipRole(
      event.payload.membershipId,
      event.payload.role,
      event.occurredAt,
    );
  }
}
