import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireSecurity } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}
const body = <T>(r: { body: unknown }): T => r.body as T;

describe("secret rotation / machine identity / ABAC-ReBAC (end to end)", () => {
  it("rotates on schedule, governs machine identities, and decides across RBAC/ReBAC/ABAC", async () => {
    let currentTime = new Date("2026-07-17T00:00:00.000Z");
    const clock: Clock = { now: () => currentTime };
    const app = wireSecurity({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
      knownSubjects: ["user-1"],
    });

    await app.security.registerPrincipal({
      externalId: "svc-1",
      kind: "service_account",
      displayName: "Service One",
      tenantRef: "t1",
      attributes: { clearance: "high" },
    });

    // ── Secret Rotation Engine (§7) ──
    const issued = await app.security.issueCredential({
      principalExternalId: "svc-1",
      kind: "api_key",
      material: "seed-A",
    });
    const credA = body<{ id: string }>(issued).id;
    const scheduled = await app.security.scheduleCredentialRotation({
      credentialId: credA,
      intervalDays: 30,
      graceSeconds: 3600,
    });
    expect(body<{ autoRotate: boolean }>(scheduled).autoRotate).toBe(true);

    // not due yet → nothing rotates
    expect(body<{ rotated: number }>(await app.security.rotateDueCredentials()).rotated).toBe(0);
    // advance past the interval → automatic rotation fires
    currentTime = new Date(currentTime.getTime() + 31 * 86_400_000);
    expect(body<{ rotated: number }>(await app.security.rotateDueCredentials()).rotated).toBe(1);

    // lineage on a manual rotation chain
    const bIssued = await app.security.issueCredential({
      principalExternalId: "svc-1",
      kind: "api_key",
      material: "seed-B",
    });
    const credB = body<{ id: string }>(bIssued).id;
    const rotatedB = await app.security.rotateCredential({
      credentialId: credB,
      newMaterial: "seed-B2",
    });
    const credC = body<{ id: string; supersedesRef: string }>(rotatedB).id;
    const lineage = body<{ chain: { id: string; supersedesRef: string | null }[] }>(
      await app.security.getCredentialLineage({ credentialId: credC }),
    );
    expect(lineage.chain).toHaveLength(2);
    expect(lineage.chain[0]?.supersedesRef).toBeNull();

    // emergency revoke kills everything for the principal
    expect(
      body<{ revoked: number }>(
        await app.security.emergencyRevokeCredentials({
          principalExternalId: "svc-1",
          reason: "key leak",
        }),
      ).revoked,
    ).toBeGreaterThan(0);

    // ── Machine Identity Governance (§14) ──
    const governed = await app.security.governMachineIdentity({
      principalExternalId: "svc-1",
      config: {
        owner: "team-billing",
        purpose: "invoicing",
        allowedScopes: ["orders:refund"],
        rotationIntervalDays: 30,
      },
    });
    expect(body<{ status: string; owner: string }>(governed).owner).toBe("team-billing");
    // humans are not machine identities
    await app.security.registerPrincipal({
      externalId: "admin-1",
      kind: "human",
      displayName: "Admin",
      subjectRef: "user-1",
      tenantRef: "t1",
    });
    expect(
      (await app.security.governMachineIdentity({ principalExternalId: "admin-1", config: {} }))
        .status,
    ).toBe(409);

    // ── Authorization evolution: RBAC / ReBAC / ABAC (§16) ──
    await app.security.defineRole({
      key: "refunder",
      name: "Refunder",
      permissions: ["orders:refund"],
    });
    await app.security.assignRole({
      principalExternalId: "svc-1",
      roleKey: "refunder",
      grantedBy: "system",
    });

    // RBAC grant
    const rbac = body<{ allowed: boolean; grantedBy: string[] }>(
      await app.security.checkAccess({ principalExternalId: "svc-1", permission: "orders:refund" }),
    );
    expect(rbac.allowed).toBe(true);
    expect(rbac.grantedBy).toEqual(["rbac"]);

    // ReBAC grant (permission not held via RBAC, granted via relationship)
    await app.security.writeRelationTuple({
      namespace: "app",
      object: "doc:readme",
      relation: "viewer",
      subject: "svc-1",
    });
    const rebac = body<{ allowed: boolean; grantedBy: string[] }>(
      await app.security.checkAccess({
        principalExternalId: "svc-1",
        permission: "docs:view",
        namespace: "app",
        object: "doc:readme",
        relation: "viewer",
      }),
    );
    expect(rebac.allowed).toBe(true);
    expect(rebac.grantedBy).toEqual(["rebac"]);

    // ABAC constraint gates an otherwise-granted permission
    const abacOk = body<{ allowed: boolean }>(
      await app.security.checkAccess({
        principalExternalId: "svc-1",
        permission: "orders:refund",
        abac: { principal: { clearance: "high" } },
      }),
    );
    expect(abacOk.allowed).toBe(true);
    const abacDenied = body<{ allowed: boolean; abacSatisfied: boolean }>(
      await app.security.checkAccess({
        principalExternalId: "svc-1",
        permission: "orders:refund",
        abac: { principal: { clearance: "top-secret" } },
      }),
    );
    expect(abacDenied.allowed).toBe(false);
    expect(abacDenied.abacSatisfied).toBe(false);

    // removing the tuple revokes the ReBAC grant
    expect(
      body<{ removed: boolean }>(
        await app.security.deleteRelationTuple({
          namespace: "app",
          object: "doc:readme",
          relation: "viewer",
          subject: "svc-1",
        }),
      ).removed,
    ).toBe(true);
    expect(
      body<{ allowed: boolean }>(
        await app.security.checkAccess({
          principalExternalId: "svc-1",
          permission: "docs:view",
          namespace: "app",
          object: "doc:readme",
          relation: "viewer",
        }),
      ).allowed,
    ).toBe(false);

    // suspend the machine identity + explorer
    await app.security.suspendMachineIdentity({ principalExternalId: "svc-1" });
    const explorer = await app.security.machineIdentityExplorer();
    expect(explorer.total).toBe(1);
    expect(explorer.suspended).toBe(1);

    // ── canonical events ──
    await app.drainOutbox();
    expect(app.deliveredEventTypes).toEqual(
      expect.arrayContaining([
        "security.credential.rotation_scheduled",
        "security.credential.rotated",
        "security.machine_identity.governed",
        "security.machine_identity.suspended",
        "security.relation.written",
        "security.relation.deleted",
      ]),
    );
  });
});
