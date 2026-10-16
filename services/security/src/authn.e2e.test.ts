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
    knownSubjects: ["user-1"],
  });
}

describe("authentication / MFA / device / risk (end to end)", () => {
  it("authenticates provider-agnostically, adapts MFA to risk, and exposes the SDK", async () => {
    const app = wire();
    app.passwordProvider.register("admin@x.com", "correct-horse", "admin-1");
    app.geoIp.seed("9.9.9.9", { tor: true, ipReputation: 100 });

    await app.security.registerPrincipal({
      tenantId: "tenant-a",
      externalId: "admin-1",
      kind: "human",
      displayName: "Admin",
      subjectRef: "user-1",
      tenantRef: "t1",
    });
    await app.security.registerAuthMethod({
      tenantId: "tenant-a",
      kind: "password",
      displayName: "Password",
    });

    // ── low-risk login → session established (no tenant MFA yet) ──
    const first = await app.security.authenticate({
      tenantId: "tenant-a",
      method: "password",
      identifier: "admin@x.com",
      credential: "correct-horse",
      deviceFingerprint: "dev-1",
      ip: "1.2.3.4",
    });
    const firstOutcome = body<{
      authenticated: boolean;
      sessionId: string | null;
      mfaRequirement: string;
    }>(first);
    expect(firstOutcome.authenticated).toBe(true);
    expect(firstOutcome.sessionId).not.toBeNull();

    // ── wrong password → failure (no session, audited) ──
    const bad = body<{ authenticated: boolean; reason?: string }>(
      await app.security.authenticate({
        tenantId: "tenant-a",
        method: "password",
        identifier: "admin@x.com",
        credential: "nope",
      }),
    );
    expect(bad.authenticated).toBe(false);

    // ── disabled/unregistered method is rejected ──
    expect(
      (await app.security.authenticate({ tenantId: "tenant-a", method: "saml", identifier: "x" }))
        .status,
    ).toBe(409);

    // ── enable tenant MFA + enroll & verify TOTP ──
    await app.security.configureTenantSecurity({
      tenantId: "tenant-a",
      tenantRef: "t1",
      config: { mfaRequired: true },
    });
    const enrolled = await app.security.enrollMfa({
      tenantId: "tenant-a",
      principalExternalId: "admin-1",
      method: "totp",
    });
    const enrollmentId = body<{ id: string }>(enrolled).id;
    const verified = await app.security.verifyMfaEnrollment({
      tenantId: "tenant-a",
      enrollmentId,
      code: "123456",
    });
    expect(body<{ status: string }>(verified).status).toBe("active");
    expect(
      (
        await app.security.verifyMfaEnrollment({
          tenantId: "tenant-a",
          enrollmentId,
          code: "000000",
        })
      ).status,
    ).toBe(409); // wrong code (already active, but provider rejects)

    // ── with tenant MFA required, a login without a satisfied factor yields no session ──
    const needsMfa = body<{ sessionId: string | null; mfaRequirement: string }>(
      await app.security.authenticate({
        tenantId: "tenant-a",
        method: "password",
        identifier: "admin@x.com",
        credential: "correct-horse",
        deviceFingerprint: "dev-1",
      }),
    );
    expect(needsMfa.sessionId).toBeNull();
    expect(needsMfa.mfaRequirement).toBe("required");

    // ── satisfying MFA establishes the session ──
    const withMfa = body<{ sessionId: string | null }>(
      await app.security.authenticate({
        tenantId: "tenant-a",
        method: "password",
        identifier: "admin@x.com",
        credential: "correct-horse",
        deviceFingerprint: "dev-1",
        mfaSatisfied: true,
      }),
    );
    expect(withMfa.sessionId).not.toBeNull();

    // ── high-risk login (Tor + bad IP) → adaptive step-up ──
    const risky = body<{ mfaRequirement: string; riskBand: string }>(
      await app.security.authenticate({
        tenantId: "tenant-a",
        method: "password",
        identifier: "admin@x.com",
        credential: "correct-horse",
        deviceFingerprint: "dev-1",
        ip: "9.9.9.9",
      }),
    );
    expect(["elevated", "high"]).toContain(risky.riskBand);
    expect(risky.mfaRequirement).toBe("step_up");

    // ── backup codes are returned once; only hashes are stored ──
    const codes = body<{ codes: string[] }>(
      await app.security.generateBackupCodes({ tenantId: "tenant-a", enrollmentId, count: 8 }),
    );
    expect(codes.codes).toHaveLength(8);

    // ── device trust + explorer ──
    await app.security.trustDevice({ tenantId: "tenant-a", fingerprint: "dev-1" });
    const explorer = await app.security.deviceExplorer("tenant-a");
    expect(explorer.total).toBeGreaterThanOrEqual(1);
    expect(explorer.trusted).toBe(1);

    // ── explicit risk evaluation is explainable ──
    const riskEval = body<{ band: string; factors: { code: string }[] }>(
      await app.security.evaluateRisk({ tenantId: "tenant-a", ip: "9.9.9.9" }),
    );
    expect(riskEval.factors.some((f) => f.code === "tor")).toBe(true);

    // ── SDK surface ──
    const sdkOutcome = await app.sdk.authenticate({
      tenantId: "tenant-a",
      method: "password",
      identifier: "admin@x.com",
      credential: "correct-horse",
      deviceFingerprint: "dev-1",
      mfaSatisfied: true,
    });
    expect(sdkOutcome.authenticated).toBe(true);
    const revoked = await app.sdk.revokeSessions({
      tenantId: "tenant-a",
      principalExternalId: "admin-1",
    });
    expect(revoked.revoked).toBeGreaterThan(0);

    // ── canonical events published ──
    await app.drainOutbox();
    expect(app.deliveredEventTypes).toEqual(
      expect.arrayContaining([
        "security.auth_method.registered",
        "security.auth.succeeded",
        "security.auth.failed",
        "security.device.registered",
        "security.device.trusted",
        "security.mfa.enrolled",
        "security.mfa.verified",
        "security.risk.evaluated",
        "security.session.revoked",
      ]),
    );
  });
});
