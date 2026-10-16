import {
  readEnvelopeTenant,
  requireEnvelopeTenant,
  type IntegrationEvent,
} from "@platform/domain-events";
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

export interface IdentityProjectionConsumerDeps {
  readonly store: IdentityProjectionStore;
  readonly logger: Logger;
}

/**
 * G-64: the row scope of every projection write is the ENVELOPE's tenant (`userTenant`/`orgTenant`
 * in the payloads are the Identity entity's own business column, not this scope). With no tenant the
 * two directions differ, per relation-sync.consumer.ts — a skipped write denies, a skipped removal
 * allows:
 *  - creates (user, organization, membership) ADD standing → REFUSED: nothing written, error logged;
 *  - user deactivation and membership role change TAKE AWAY standing → THROW to the retry/DLQ, since
 *    acking a skipped one would leave the old, wider projection live.
 */
function tenantOrRefuse(
  deps: IdentityProjectionConsumerDeps,
  event: { readonly tenantId?: unknown; readonly type: string; readonly messageId: string },
): string | null {
  const tenantId = readEnvelopeTenant(event);
  if (tenantId === null) {
    deps.logger.error(`${event.type} has no tenant on the envelope — projection write refused`, {
      messageId: event.messageId,
    });
  }
  return tenantId;
}

export interface IdentityUserCreatedPayload {
  readonly userId: string;
  readonly tenantId: string;
}
export class IdentityUserCreatedConsumer implements EventHandler<IdentityUserCreatedPayload> {
  readonly eventType = "identity.user.created";
  readonly eventVersion = 1;
  constructor(private readonly deps: IdentityProjectionConsumerDeps) {}
  async handle(event: IntegrationEvent<IdentityUserCreatedPayload>): Promise<void> {
    const tenantId = tenantOrRefuse(this.deps, event);
    if (tenantId === null) return;
    await this.deps.store.upsertUser(
      {
        userId: event.payload.userId,
        userTenant: event.payload.tenantId,
        status: "active",
        occurredAt: event.occurredAt,
      },
      tenantId,
    );
  }
}

export type IdentityUserDeactivatedPayload = { readonly userId: string };
export class IdentityUserDeactivatedConsumer implements EventHandler<IdentityUserDeactivatedPayload> {
  readonly eventType = "identity.user.deactivated";
  readonly eventVersion = 1;
  constructor(private readonly deps: IdentityProjectionConsumerDeps) {}
  async handle(event: IntegrationEvent<IdentityUserDeactivatedPayload>): Promise<void> {
    const tenantId = requireEnvelopeTenant(event, "IdentityUserDeactivatedConsumer");
    await this.deps.store.setUserStatus(
      event.payload.userId,
      "deactivated",
      event.occurredAt,
      tenantId,
    );
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
  constructor(private readonly deps: IdentityProjectionConsumerDeps) {}
  async handle(event: IntegrationEvent<IdentityOrganizationCreatedPayload>): Promise<void> {
    const tenantId = tenantOrRefuse(this.deps, event);
    if (tenantId === null) return;
    await this.deps.store.upsertOrganization(
      {
        organizationId: event.payload.organizationId,
        slug: event.payload.slug,
        orgTenant: event.payload.tenantId,
        occurredAt: event.occurredAt,
      },
      tenantId,
    );
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
  constructor(private readonly deps: IdentityProjectionConsumerDeps) {}
  async handle(event: IntegrationEvent<IdentityMembershipCreatedPayload>): Promise<void> {
    const tenantId = tenantOrRefuse(this.deps, event);
    if (tenantId === null) return;
    await this.deps.store.upsertMembership(
      {
        membershipId: event.payload.membershipId,
        userId: event.payload.userId,
        organizationId: event.payload.organizationId,
        role: event.payload.role,
        occurredAt: event.occurredAt,
      },
      tenantId,
    );
  }
}

export interface IdentityMembershipRoleChangedPayload {
  readonly membershipId: string;
  readonly role: string;
}
export class IdentityMembershipRoleChangedConsumer implements EventHandler<IdentityMembershipRoleChangedPayload> {
  readonly eventType = "identity.membership.role_changed";
  readonly eventVersion = 1;
  constructor(private readonly deps: IdentityProjectionConsumerDeps) {}
  async handle(event: IntegrationEvent<IdentityMembershipRoleChangedPayload>): Promise<void> {
    const tenantId = requireEnvelopeTenant(event, "IdentityMembershipRoleChangedConsumer");
    await this.deps.store.setMembershipRole(
      event.payload.membershipId,
      event.payload.role,
      event.occurredAt,
      tenantId,
    );
  }
}
