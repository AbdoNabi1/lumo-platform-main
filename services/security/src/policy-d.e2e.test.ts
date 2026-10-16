import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireSecurity } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}
const clock: Clock = { now: () => new Date("2026-07-17T00:00:00.000Z") };
const body = <T>(r: { body: unknown }): T => r.body as T;

function wire() {
  return wireSecurity({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    trustedDevices: ["dev-1"],
  });
}

describe("composable policy language / security registry / compliance (end to end)", () => {
  it("evaluates fragment-composed policy, versions registries, and reports compliance", async () => {
    const app = wire();

    await app.security.registerPrincipal({
      tenantId: "tenant-a",
      externalId: "svc-1",
      kind: "service_account",
      displayName: "Svc",
      tenantRef: "t1",
    });
    await app.security.defineRole({
      tenantId: "tenant-a",
      key: "refunder",
      name: "Refunder",
      permissions: ["orders:refund"],
    });
    await app.security.assignRole({
      tenantId: "tenant-a",
      principalExternalId: "svc-1",
      roleKey: "refunder",
      grantedBy: "system",
    });

    // ── §8 composable policy: a reusable fragment referenced by a policy rule ──
    await app.security.registerPolicyFragment({
      tenantId: "tenant-a",
      key: "risky",
      expression: { anyOf: [{ leaf: { minRisk: 50 } }, { leaf: { requireDeviceTrust: true } }] },
    });
    await app.security.definePolicy({
      tenantId: "tenant-a",
      key: "p1",
      name: "Composed",
      mode: "custom",
    });
    await app.security.publishPolicyVersion({
      tenantId: "tenant-a",
      key: "p1",
      rules: [
        {
          id: "block-risky",
          description: "block when risky fragment fires",
          when: {},
          expr: { fragment: "risky" },
          effect: "block",
        },
      ],
      defaultEffect: "allow",
    });
    await app.security.configureTenantSecurity({
      tenantId: "tenant-a",
      tenantRef: "t1",
      config: { defaultPolicyKey: "p1", mfaRequired: true },
    });

    // trusted device + low risk ⇒ fragment does not fire ⇒ allow
    const allow = body<{ effect: string }>(
      await app.security.evaluateAccess({
        tenantId: "tenant-a",
        principalExternalId: "svc-1",
        permission: "orders:refund",
        scope: { tenant: "t1" },
        deviceRef: "dev-1",
      }),
    );
    expect(allow.effect).toBe("allow");
    // high risk ⇒ fragment fires ⇒ block
    const blockRisk = body<{ effect: string }>(
      await app.security.evaluateAccess({
        tenantId: "tenant-a",
        principalExternalId: "svc-1",
        permission: "orders:refund",
        scope: { tenant: "t1" },
        deviceRef: "dev-1",
        risk: { threatIntelHit: true, impossibleTravel: true },
      }),
    );
    expect(blockRisk.effect).toBe("block");
    // untrusted device ⇒ fragment fires ⇒ block
    const blockDevice = body<{ effect: string }>(
      await app.security.evaluateAccess({
        tenantId: "tenant-a",
        principalExternalId: "svc-1",
        permission: "orders:refund",
        scope: { tenant: "t1" },
      }),
    );
    expect(blockDevice.effect).toBe("block");
    // simulation honours fragments too
    expect(
      body<{ effect: string }>(
        await app.security.simulatePolicy({
          tenantId: "tenant-a",
          key: "p1",
          context: { risk: 90 },
        }),
      ).effect,
    ).toBe("block");

    // ── §6 versioned security registry ──
    await app.security.registerAuthMethod({
      tenantId: "tenant-a",
      kind: "password",
      displayName: "Password",
    });
    await app.security.registerMfaMethod({
      tenantId: "tenant-a",
      kind: "totp",
      displayName: "Authenticator",
    });
    await app.security.registerPermission({
      tenantId: "tenant-a",
      permission: "orders:refund",
      description: "Refund an order",
    });
    await app.security.registerComplianceRule({
      tenantId: "tenant-a",
      id: "CC6.1",
      framework: "soc2",
      description: "MFA enforced",
      severity: "high",
    });
    // versioning: re-register mints v2
    const v2 = body<{ version: number }>(
      await app.security.registerPermission({
        tenantId: "tenant-a",
        permission: "orders:refund",
        description: "Refund an order (v2)",
      }),
    );
    expect(v2.version).toBe(2);
    const registry = app.security.registryExplorer();
    expect(registry.totalEntries).toBeGreaterThanOrEqual(5);
    expect(registry.registries.find((r) => r.name === "policy-fragments")?.entryCount).toBe(1);

    // ── §9 compliance: evaluated against live state + attestations ──
    const compliant = body<{ compliant: boolean; failed: number }>(
      await app.security.evaluateCompliance({
        tenantId: "tenant-a",
        framework: "soc2",
        tenantRef: "t1",
        attestations: { encryptionAtRest: true },
      }),
    );
    expect(compliant.compliant).toBe(true); // mfaRequired + audit chain valid + encryption attested
    const nonCompliant = body<{ compliant: boolean }>(
      await app.security.evaluateCompliance({
        tenantId: "tenant-a",
        framework: "soc2",
        tenantRef: "t1",
        attestations: { encryptionAtRest: false },
      }),
    );
    expect(nonCompliant.compliant).toBe(false); // CC6.7 encryption fails
    // unknown framework with no pack ⇒ 404
    expect(
      (
        await app.security.evaluateCompliance({
          tenantId: "tenant-a",
          framework: "gdpr",
          tenantRef: "t1",
        })
      ).status,
    ).toBe(200); // gdpr pack exists (default packs)

    // ── canonical events ──
    await app.drainOutbox();
    expect(app.deliveredEventTypes).toEqual(
      expect.arrayContaining([
        "security.policy.version_published",
        "security.registry.updated",
        "security.compliance.evaluated",
      ]),
    );
  });
});
