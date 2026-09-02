import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { ConsentChanged } from "../domain/events/consent-changed.event";
import { CustomerRegistered } from "../domain/events/customer-registered.event";
import { MembershipCreated } from "../domain/events/membership-created.event";
import { MembershipRoleChanged } from "../domain/events/membership-role-changed.event";
import { OrganizationCreated } from "../domain/events/organization-created.event";
import { UserCreated } from "../domain/events/user-created.event";
import { UserDeactivated } from "../domain/events/user-deactivated.event";
import { UserUpdated } from "../domain/events/user-updated.event";

/** Every integration event type this translator can produce (C1: Access, runtime verification). */
export const IDENTITY_PUBLISHED_EVENTS = [
  "identity.customer.registered",
  "identity.customer.consent_changed",
  "identity.user.created",
  "identity.user.updated",
  "identity.user.deactivated",
  "identity.organization.created",
  "identity.membership.created",
  "identity.membership.role_changed",
] as const;

/**
 * Maps Identity domain events to integration events. Deliberately does NOT forward
 * `CustomerRegistered`'s or `UserCreated`'s `email` (data minimization, ADR-0006): integration
 * events are long-retained and shared across contexts, so raw PII on them would make GDPR erasure
 * a topic rewrite. Consumers that need profile details fetch them from Identity by id. No
 * `identity.permission.*`/`identity.role.*` event — permissions/roles are Keto's (Option A).
 */
export class IdentityEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof CustomerRegistered) {
      return {
        type: "identity.customer.registered",
        eventVersion: 1,
        aggregateType: "customer",
        payload: { customerId: event.aggregateId.toString() },
      };
    }
    if (event instanceof ConsentChanged) {
      return {
        type: "identity.customer.consent_changed",
        eventVersion: 1,
        aggregateType: "customer",
        payload: event.data,
      };
    }
    if (event instanceof UserCreated) {
      return {
        type: "identity.user.created",
        eventVersion: 1,
        aggregateType: "user",
        payload: { userId: event.aggregateId.toString(), tenantId: event.data.tenantId },
      };
    }
    if (event instanceof UserUpdated) {
      return {
        type: "identity.user.updated",
        eventVersion: 1,
        aggregateType: "user",
        payload: { userId: event.aggregateId.toString(), tenantId: event.data.tenantId },
      };
    }
    if (event instanceof UserDeactivated) {
      return {
        type: "identity.user.deactivated",
        eventVersion: 1,
        aggregateType: "user",
        payload: { userId: event.aggregateId.toString(), tenantId: event.data.tenantId },
      };
    }
    if (event instanceof OrganizationCreated) {
      return {
        type: "identity.organization.created",
        eventVersion: 1,
        aggregateType: "organization",
        payload: { organizationId: event.aggregateId.toString(), ...event.data },
      };
    }
    if (event instanceof MembershipCreated) {
      return {
        type: "identity.membership.created",
        eventVersion: 1,
        aggregateType: "membership",
        payload: { membershipId: event.aggregateId.toString(), ...event.data },
      };
    }
    if (event instanceof MembershipRoleChanged) {
      return {
        type: "identity.membership.role_changed",
        eventVersion: 1,
        aggregateType: "membership",
        payload: { membershipId: event.aggregateId.toString(), ...event.data },
      };
    }
    return undefined;
  }
}
