import { beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@platform/contracts";
import type { IntegrationEvent } from "@platform/domain-events";
import { JsonEventSerializer } from "@platform/domain-events";
import { SystemClock } from "@platform/clock";
import { CryptoIdGenerator } from "@platform/id";
import { logger } from "@platform/utils";
import { wireSecurity, type WiredSecurity } from "@platform/security";
import { bootstrapSecurity, PLATFORM_ADMIN_ROLE } from "./bootstrap-security";
import {
  AssignRoleOnMembershipCreated,
  DisablePrincipalOnUserDeactivated,
  ProvisionPrincipalOnUserCreated,
} from "./security-provisioning.consumers";
import { wireSecurityEdge } from "./wire-security-edge";
import type { SecurityPermissionGuard } from "./edge-middleware";

/**
 * P2.0.2 runtime security — the **complete zero-trust decision chain executed inside a real request**,
 * end to end, entirely offline. It proves JWT-subject → Security Principal → Role → Policy → RBAC/ABAC
 * authorization → risk → device → step-up → WORM audit, using the SAME runtime wiring the production
 * process uses (`bootstrapSecurity`, the provisioning consumers, `wireSecurityEdge` → `SecurityPermissionGuard`),
 * only with the context's in-memory slice standing in for Postgres/Kafka/Ory (the durable slice is the
 * Prisma repositories — identical contracts, live-infra-verified separately). Nothing here is faked: every
 * decision runs the real use-cases + evaluator.
 */
const ADMIN_USER = "user-admin-1";
const SERVICE_USER = "user-service-1";
const TENANT = "tenant-local";
const DEVICE = "device-trusted-1";

function makeEvent<T>(type: string, payload: T): IntegrationEvent<T> {
  return {
    messageId: `msg-${type}-${JSON.stringify(payload)}`,
    type,
    eventVersion: 1,
    aggregateId: "agg-1",
    aggregateType: "user",
    occurredAt: new Date("2026-07-19T00:00:00.000Z").toISOString(),
    correlationId: "corr-1",
    causationId: "cause-1",
    payload,
    metadata: {},
  };
}

async function establishSession(
  wired: WiredSecurity,
  principalExternalId: string,
): Promise<string> {
  const res = await wired.security.establishSession({
    tenantId: TENANT,
    principalExternalId,
    refreshFingerprint: "fp-1",
    deviceRef: DEVICE,
    ttlSeconds: 3600,
  });
  expect(res.status).toBeLessThan(300);
  return (res.body as { id: string }).id;
}

describe("P2.0.2 runtime security — provisioning + zero-trust enforcement chain", () => {
  let wired: WiredSecurity;
  let guard: SecurityPermissionGuard;

  beforeEach(async () => {
    // The context's in-memory slice with the same seams the runtime binds; known Identity subjects let the
    // human-principal registration's directory check pass offline (Kratos verifies it in production).
    wired = wireSecurity({
      serializer: new JsonEventSerializer(),
      idGenerator: new CryptoIdGenerator(),
      clock: new SystemClock(),
      knownSubjects: [ADMIN_USER, SERVICE_USER],
      trustedDevices: [DEVICE],
    });
    await bootstrapSecurity(wired.security, TENANT, logger);
    guard = wireSecurityEdge({ logger }).buildGuard(wired.sdk);
  });

  it("provisions a Security Principal + role from Identity events (blocker A/D/E)", async () => {
    const deps = { security: wired.security, logger, tenantId: TENANT };
    await new ProvisionPrincipalOnUserCreated(deps).handle(
      makeEvent("identity.user.created", { userId: ADMIN_USER, tenantId: TENANT }),
    );
    await new AssignRoleOnMembershipCreated(deps).handle(
      makeEvent("identity.membership.created", {
        membershipId: "m-1",
        userId: ADMIN_USER,
        organizationId: "org-1",
        role: "admin",
      }),
    );

    // The RBAC grant resolves (proves RegisterPrincipal + AssignRole → platform-admin took effect for the
    // evaluator, which resolves principals from the principal repository the provisioning consumers write).
    const decision = await wired.sdk.authorize({
      tenantId: TENANT,
      principalExternalId: ADMIN_USER,
      permission: "orders:read",
      sessionId: await establishSession(wired, ADMIN_USER),
    });
    expect(decision.roleKeys).toContain(PLATFORM_ADMIN_ROLE);
  });

  it("ALLOWS an authenticated request through the guard: full chain, WORM-audited (blocker C/H)", async () => {
    const deps = { security: wired.security, logger, tenantId: TENANT };
    await new ProvisionPrincipalOnUserCreated(deps).handle(
      makeEvent("identity.user.created", { userId: ADMIN_USER, tenantId: TENANT }),
    );
    await new AssignRoleOnMembershipCreated(deps).handle(
      makeEvent("identity.membership.created", {
        membershipId: "m-1",
        userId: ADMIN_USER,
        organizationId: "org-1",
        role: "admin",
      }),
    );
    const sessionId = await establishSession(wired, ADMIN_USER);
    const principal: Principal = { id: ADMIN_USER, kind: "staff", roles: [], tenantId: TENANT };

    const denied = await guard.ensure(principal, "orders:read", {
      tenantId: TENANT,
      sessionId,
      deviceRef: DEVICE,
      ip: "203.0.113.7",
    });
    expect(denied).toBeNull(); // null ⇒ allowed

    // WORM audit ledger received the decision (+ registration/session) and its hash chain verifies.
    const audit = await wired.security.verifyAuditChain({ tenantId: TENANT });
    expect(audit.status).toBeLessThan(300);
    expect((audit.body as { valid: boolean; count: number }).valid).toBe(true);
    expect((audit.body as { count: number }).count).toBeGreaterThan(0);
    // Telemetry incremented (feeds the OTel security dashboard in production).
    expect(wired.telemetry.snapshot()["security.access.allowed"]).toBeGreaterThan(0);
  });

  it("DENIES when RBAC does not grant the permission (fail-closed)", async () => {
    const deps = { security: wired.security, logger, tenantId: TENANT };
    await new ProvisionPrincipalOnUserCreated(deps).handle(
      makeEvent("identity.user.created", { userId: SERVICE_USER, tenantId: TENANT }),
    );
    // A "member" membership maps to platform-service (only *:read).
    await new AssignRoleOnMembershipCreated(deps).handle(
      makeEvent("identity.membership.created", {
        membershipId: "m-2",
        userId: SERVICE_USER,
        organizationId: "org-1",
        role: "member",
      }),
    );
    const sessionId = await establishSession(wired, SERVICE_USER);
    const principal: Principal = { id: SERVICE_USER, kind: "staff", roles: [], tenantId: TENANT };

    const denied = await guard.ensure(principal, "orders:write", {
      tenantId: TENANT,
      sessionId,
      deviceRef: DEVICE,
      ip: "203.0.113.7",
    });
    expect(denied?.status).toBe(403);
    expect(wired.telemetry.snapshot()["security.access.denied"]).toBeGreaterThan(0);
  });

  it("fails closed for a human principal with no valid session (zero-trust structural gate)", async () => {
    const deps = { security: wired.security, logger, tenantId: TENANT };
    await new ProvisionPrincipalOnUserCreated(deps).handle(
      makeEvent("identity.user.created", { userId: ADMIN_USER, tenantId: TENANT }),
    );
    await new AssignRoleOnMembershipCreated(deps).handle(
      makeEvent("identity.membership.created", {
        membershipId: "m-1",
        userId: ADMIN_USER,
        organizationId: "org-1",
        role: "admin",
      }),
    );
    const principal: Principal = { id: ADMIN_USER, kind: "staff", roles: [], tenantId: TENANT };

    const denied = await guard.ensure(principal, "orders:read", {
      tenantId: TENANT,
      deviceRef: DEVICE,
    }); // no sessionId
    expect(denied?.status).toBe(403);
    expect(JSON.stringify(denied?.body)).toContain("no valid session");
  });

  it("steps up (challenge) at elevated risk and blocks at high risk (risk + policy in the chain)", async () => {
    const deps = { security: wired.security, logger, tenantId: TENANT };
    await new ProvisionPrincipalOnUserCreated(deps).handle(
      makeEvent("identity.user.created", { userId: ADMIN_USER, tenantId: TENANT }),
    );
    await new AssignRoleOnMembershipCreated(deps).handle(
      makeEvent("identity.membership.created", {
        membershipId: "m-1",
        userId: ADMIN_USER,
        organizationId: "org-1",
        role: "admin",
      }),
    );
    const sessionId = await establishSession(wired, ADMIN_USER);

    // threatIntelHit (+40) + ipReputation 100 (+30) = 70 ⇒ challenge (>= 60, < 85).
    const stepUp = await wired.sdk.authorize({
      tenantId: TENANT,
      principalExternalId: ADMIN_USER,
      permission: "orders:read",
      sessionId,
      deviceRef: DEVICE,
      risk: { threatIntelHit: true, ipReputation: 100 },
    });
    expect(stepUp.effect).toBe("challenge");
    expect(stepUp.allowed).toBe(false);

    // + newDevice (+15) = 85 ⇒ block (>= 85).
    const blocked = await wired.sdk.authorize({
      tenantId: TENANT,
      principalExternalId: ADMIN_USER,
      permission: "orders:read",
      sessionId,
      deviceRef: DEVICE,
      risk: { threatIntelHit: true, ipReputation: 100, newDevice: true },
    });
    expect(blocked.effect).toBe("block");
  });

  it("disables the Security Principal when Identity deactivates the user (lifecycle sync, D)", async () => {
    const deps = { security: wired.security, logger, tenantId: TENANT };
    await new ProvisionPrincipalOnUserCreated(deps).handle(
      makeEvent("identity.user.created", { userId: ADMIN_USER, tenantId: TENANT }),
    );
    await new DisablePrincipalOnUserDeactivated(deps).handle(
      makeEvent("identity.user.deactivated", { userId: ADMIN_USER }),
    );

    const sessionId = await establishSession(wired, ADMIN_USER);
    // A disabled principal fails the "principal is not active" structural gate regardless of RBAC.
    const decision = await wired.sdk.authorize({
      tenantId: TENANT,
      principalExternalId: ADMIN_USER,
      permission: "orders:read",
      sessionId,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(" ")).toContain("not active");
  });

  it("re-drives (throws) when a role assignment races ahead of its principal (retry/DLQ, fail-closed)", async () => {
    const deps = { security: wired.security, logger, tenantId: TENANT };
    // membership.created before user.created ⇒ principal not found ⇒ throw so the runtime retries.
    await expect(
      new AssignRoleOnMembershipCreated(deps).handle(
        makeEvent("identity.membership.created", {
          membershipId: "m-9",
          userId: "user-unknown",
          organizationId: "org-1",
          role: "admin",
        }),
      ),
    ).rejects.toThrow();
  });
});
