import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireSecurity } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}
const clock: Clock = { now: () => new Date("2026-07-17T00:00:00.000Z") };

function wire() {
  return wireSecurity({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    knownSubjects: ["user-1"],
    trustedDevices: ["dev-1"],
  });
}

const body = <T>(r: { body: unknown }): T => r.body as T;

describe("security context (end to end)", () => {
  it("runs the full identity → authorization → zero-trust → audit flow with canonical events", async () => {
    const app = wire();

    // ── Identity: a non-human (service) principal + a human principal (referenced from Identity) ──
    const svc = await app.security.registerPrincipal({
      externalId: "svc-billing",
      kind: "service_account",
      displayName: "Billing Service",
      tenantRef: "t1",
    });
    expect(svc.status).toBe(201);
    const human = await app.security.registerPrincipal({
      externalId: "admin-1",
      kind: "human",
      displayName: "Admin",
      subjectRef: "user-1",
      tenantRef: "t1",
    });
    expect(human.status).toBe(201);
    // human with unknown subject is rejected
    expect(
      (
        await app.security.registerPrincipal({
          externalId: "ghost",
          kind: "human",
          displayName: "Ghost",
          subjectRef: "nope",
        })
      ).status,
    ).toBe(404);

    // ── Credentials: issue → rotate (no secret value ever stored) ──
    const issued = await app.security.issueCredential({
      principalExternalId: "svc-billing",
      kind: "api_key",
      material: "super-secret-value",
    });
    expect(issued.status).toBe(201);
    const credId = body<{ id: string }>(issued).id;
    const rotated = await app.security.rotateCredential({
      credentialId: credId,
      newMaterial: "next-secret",
    });
    expect(rotated.status).toBe(200);
    expect(body<{ supersedesRef: string }>(rotated).supersedesRef).toBe(credId);

    // ── Sessions: establish → introspect → refresh (token rotation) ──
    const session = await app.security.establishSession({
      principalExternalId: "admin-1",
      refreshFingerprint: "rt-1",
      deviceRef: "dev-1",
      ttlSeconds: 3600,
    });
    const sessionId = body<{ id: string }>(session).id;
    expect(
      body<{ active: boolean }>(await app.security.introspectSession({ sessionId })).active,
    ).toBe(true);
    const refreshed = await app.security.refreshSession({
      sessionId,
      newRefreshFingerprint: "rt-2",
      ttlSeconds: 3600,
    });
    expect(body<{ refreshCount: number }>(refreshed).refreshCount).toBe(1);

    // ── Authorization: role (with a permission) assigned to the service principal ──
    await app.security.defineRole({
      key: "billing-operator",
      name: "Billing Operator",
      permissions: ["orders:refund"],
    });
    const assigned = await app.security.assignRole({
      principalExternalId: "svc-billing",
      roleKey: "billing-operator",
      grantedBy: "admin-1",
    });
    expect(assigned.status).toBe(201);

    // ── Policy + tenant profile: balanced policy blocks only on high risk ──
    await app.security.definePolicy({
      key: "tenant-default",
      name: "Tenant Default",
      mode: "balanced",
    });
    await app.security.publishPolicyVersion({
      key: "tenant-default",
      rules: [
        {
          id: "block-high-risk",
          description: "block high risk",
          when: { minRisk: 80 },
          effect: "block",
        },
      ],
    });
    await app.security.configureTenantSecurity({
      tenantRef: "t1",
      config: { securityMode: "balanced", defaultPolicyKey: "tenant-default", mfaRequired: true },
    });

    // ── Zero-trust evaluation: allowed at low risk ──
    const allow = await app.security.evaluateAccess({
      principalExternalId: "svc-billing",
      permission: "orders:refund",
      scope: { tenant: "t1" },
      environment: "production",
    });
    const allowDecision = body<{ allowed: boolean; effect: string; roleKeys: string[] }>(allow);
    expect(allowDecision.allowed).toBe(true);
    expect(allowDecision.roleKeys).toContain("billing-operator");

    // blocked at high risk (threat intel + impossible travel + new device ⇒ ≥80)
    const risky = await app.security.evaluateAccess({
      principalExternalId: "svc-billing",
      permission: "orders:refund",
      scope: { tenant: "t1" },
      risk: { threatIntelHit: true, impossibleTravel: true, newDevice: true },
    });
    expect(body<{ effect: string }>(risky).effect).toBe("block");

    // blocked when the permission is not granted (fails closed)
    const denied = await app.security.evaluateAccess({
      principalExternalId: "svc-billing",
      permission: "system:admin",
      scope: { tenant: "t1" },
    });
    expect(body<{ effect: string }>(denied).effect).toBe("block");

    // malformed permission ⇒ 422
    expect(
      (
        await app.security.evaluateAccess({
          principalExternalId: "svc-billing",
          permission: "bad-permission",
        })
      ).status,
    ).toBe(422);

    // ── Delegation + impersonation ──
    await app.security.registerPrincipal({
      externalId: "support-1",
      kind: "human",
      displayName: "Support",
      subjectRef: "user-1",
      tenantRef: "t1",
    });
    const delegation = await app.security.grantDelegation({
      delegatorExternalId: "admin-1",
      delegateExternalId: "support-1",
      ttlSeconds: 600,
    });
    const delegationId = body<{ id: string }>(delegation).id;
    const impersonation = await app.security.startImpersonation({
      delegationId,
      refreshFingerprint: "imp-rt",
      ttlSeconds: 300,
    });
    expect(impersonation.status).toBe(201);
    expect(body<{ impersonatedBy: string }>(impersonation).impersonatedBy).toBeDefined();

    // ── Policy simulation (Part 3) ──
    const sim = await app.security.simulatePolicy({ key: "tenant-default", context: { risk: 90 } });
    expect(body<{ effect: string }>(sim).effect).toBe("block");

    // ── WORM audit chain verifies ──
    const verify = await app.security.verifyAuditChain({ tenantRef: "t1" });
    const report = body<{ valid: boolean; count: number }>(verify);
    expect(report.valid).toBe(true);
    expect(report.count).toBeGreaterThan(0);

    // ── Console read models (Part 10) ──
    const overview = await app.security.identityOverview();
    expect(overview.total).toBe(3);
    expect(overview.humans).toBe(2);
    expect(overview.nonHumans).toBe(1);
    const explorer = await app.security.permissionExplorer();
    expect(explorer.roles.map((r) => r.key)).toContain("billing-operator");
    const dashboard = await app.security.securityDashboard("t1");
    expect(dashboard.chainValid).toBe(true);

    // ── Canonical events published through the outbox ──
    await app.drainOutbox();
    expect(app.deliveredEventTypes).toEqual(
      expect.arrayContaining([
        "security.principal.registered",
        "security.credential.issued",
        "security.credential.rotated",
        "security.session.established",
        "security.session.refreshed",
        "security.role.defined",
        "security.role.assigned",
        "security.policy.defined",
        "security.policy.version_published",
        "security.tenant_profile.configured",
        "security.delegation.granted",
        "security.access.evaluated",
        "security.audit.recorded",
      ]),
    );
  });
});
