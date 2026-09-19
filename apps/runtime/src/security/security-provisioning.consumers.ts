import type { IntegrationEvent } from "@platform/domain-events";
import type { EventHandler } from "@platform/messaging";
import type {
  ControllerResponse,
  IdentityMembershipCreatedPayload,
  IdentityUserCreatedPayload,
  IdentityUserDeactivatedPayload,
  SecurityController,
} from "@platform/security";
import type { Logger } from "@platform/utils";
import { PLATFORM_ADMIN_ROLE, PLATFORM_SERVICE_ROLE, SYSTEM_GRANTOR } from "./bootstrap-security";

/**
 * Security **principal provisioning** consumers (P2.0.2 blockers A / D / E). They close the gap the
 * P2.0.1 audit named: the H-2 identity-projection consumers maintain only a *read model*, so no runtime
 * path ever created a Security **Principal** — and `EvaluateAccess` resolves principals from the principal
 * repository, so mounting the guard denied 100% of traffic. These consumers project the SAME already
 * published `identity.*` integration events into the Security principal + role-assignment lifecycle by
 * reusing the existing `RegisterPrincipal` / `AssignRole` / `TransitionPrincipal` use-cases (via the
 * `SecurityController`) — never bypassing them, never writing the store directly.
 *
 * Ownership is unchanged (ADR-0023): Identity owns the human user; Security stores only a `subjectRef`
 * back to it. A human principal's `externalId` is the Identity user id — the value the JWT carries as its
 * subject, which the HTTP guard uses as `principalExternalId` — so provisioning and enforcement resolve the
 * same identity. Registration verifies the `subjectRef` against the live Identity directory (Kratos) inside
 * `RegisterPrincipal`; that live check is the one part gated on real infrastructure.
 *
 * Idempotency + ordering: `RegisterPrincipal` is idempotent per `externalId`; a role assignment that
 * arrives before its principal (cross-aggregate races) throws so the consumer runtime's retry/DLQ pipeline
 * re-drives it (fail-closed — a missing grant is never silently dropped).
 */

/** Maps an Identity membership role to the baseline Security role (owners/admins ⇒ full admin). */
export function mapMembershipRole(role: string): string {
  const normalized = role.trim().toLowerCase();
  return normalized === "owner" || normalized === "admin"
    ? PLATFORM_ADMIN_ROLE
    : PLATFORM_SERVICE_ROLE;
}

/** Throws on a non-success controller response so the retry/DLQ pipeline re-drives (fail-closed). */
function ensureProvisioned(response: ControllerResponse, action: string): void {
  if (response.status >= 300) {
    throw new Error(
      `security provisioning "${action}" failed (status ${response.status}): ${JSON.stringify(response.body)}`,
    );
  }
}

interface ProvisioningDeps {
  readonly security: SecurityController;
  readonly logger: Logger;
  /**
   * ADR-0014 (WP-10, T10.3): every `SecurityController` use-case takes `tenantId` per call. Until
   * `tenantId` is required on the event envelope (G-64 — a contract change, out of scope here) the
   * composition root supplies it, exactly as the other event consumers in `apps/runtime` do; reading
   * the envelope tenant per message is the separate G-64 fix. (`tenantRef` below is the Identity
   * user's own tenant, a business attribute — not this row scope.)
   */
  readonly tenantId: string;
}

/** `identity.user.created` → register the human Security Principal (idempotent per Identity user id). */
export class ProvisionPrincipalOnUserCreated implements EventHandler<IdentityUserCreatedPayload> {
  readonly eventType = "identity.user.created";
  readonly eventVersion = 1;
  constructor(private readonly deps: ProvisioningDeps) {}
  async handle(event: IntegrationEvent<IdentityUserCreatedPayload>): Promise<void> {
    const { userId, tenantId } = event.payload;
    ensureProvisioned(
      await this.deps.security.registerPrincipal({
        tenantId: this.deps.tenantId,
        externalId: userId,
        kind: "human",
        displayName: userId,
        subjectRef: userId,
        tenantRef: tenantId,
      }),
      "registerPrincipal",
    );
  }
}

/** `identity.user.deactivated` → disable the Security Principal (keeps the principal lifecycle in sync, D). */
export class DisablePrincipalOnUserDeactivated implements EventHandler<IdentityUserDeactivatedPayload> {
  readonly eventType = "identity.user.deactivated";
  readonly eventVersion = 1;
  constructor(private readonly deps: ProvisioningDeps) {}
  async handle(event: IntegrationEvent<IdentityUserDeactivatedPayload>): Promise<void> {
    ensureProvisioned(
      await this.deps.security.transitionPrincipal({
        tenantId: this.deps.tenantId,
        externalId: event.payload.userId,
        to: "disabled",
      }),
      "transitionPrincipal(disabled)",
    );
  }
}

/** `identity.membership.created` → assign the mapped Security role to the principal (E). */
export class AssignRoleOnMembershipCreated implements EventHandler<IdentityMembershipCreatedPayload> {
  readonly eventType = "identity.membership.created";
  readonly eventVersion = 1;
  constructor(private readonly deps: ProvisioningDeps) {}
  async handle(event: IntegrationEvent<IdentityMembershipCreatedPayload>): Promise<void> {
    ensureProvisioned(
      await this.deps.security.assignRole({
        tenantId: this.deps.tenantId,
        principalExternalId: event.payload.userId,
        roleKey: mapMembershipRole(event.payload.role),
        grantedBy: SYSTEM_GRANTOR,
      }),
      "assignRole",
    );
  }
}
