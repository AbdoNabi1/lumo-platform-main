import { Registry } from "@platform/registry";
import { describe, expect, it } from "vitest";
import { MfaEnrollment } from "../domain/mfa-enrollment";
import { Principal } from "../domain/principal";
import { TenantSecurityProfile } from "../domain/tenant-security-profile";
import type { AuthMethodSpec } from "../domain/value-objects/auth-method";
import { RiskEngine } from "../domain/risk-engine";
import { MfaEngine } from "../domain/mfa-engine";
import {
  InMemoryGeoIp,
  InMemoryPasswordAuthProvider,
  MapAuthenticationProviderResolver,
  NodeCrypto,
} from "../infrastructure/in-memory-auth-adapters";
import { buildStaffKit, type StaffKit } from "../infrastructure/staff-test-kit";
import { Authenticate, type AuthenticationOutcome } from "./authentication.use-cases";
import type { SecurityDeps } from "./deps";
import { DecideMfa } from "./mfa.use-cases";

const T = "shop-a";
const PASSWORD = "correct horse 1";

/** The Authenticate slice of SecurityDeps over the staff kit's real in-memory adapters. */
function build() {
  const kit = buildStaffKit();
  const provider = new InMemoryPasswordAuthProvider();
  const registry = new Registry<AuthMethodSpec>({
    name: "auth-methods",
    now: () => kit.clock.now(),
  });
  registry.register({
    key: "password",
    value: { kind: "password", enabled: true, displayName: "Password" },
    tags: ["enabled"],
  });
  const deps = {
    ...kit.deps,
    devices: { findByFingerprint: () => Promise.resolve(null), save: () => Promise.resolve() },
    mfaEnrollments: kit.mfaEnrollments,
    tenantProfiles: kit.tenantProfiles,
    crypto: new NodeCrypto(),
    geoIp: new InMemoryGeoIp(),
    riskEngine: new RiskEngine(),
    mfaEngine: new MfaEngine(),
    authMethodRegistry: registry,
    authProviders: new MapAuthenticationProviderResolver([provider]),
  } as unknown as SecurityDeps;
  return { kit, provider, deps, authenticate: new Authenticate(deps), decide: new DecideMfa(deps) };
}

async function seedMember(ctx: ReturnType<typeof build>, externalId: string, email: string) {
  const internalId = await ctx.kit.seedStaff(T, { externalId, email, roles: ["admin"] });
  ctx.provider.register(`staff:${email}`, PASSWORD, externalId);
  return internalId;
}

async function enrolActive(kit: StaffKit, internalId: string): Promise<void> {
  const enrollment = MfaEnrollment.enroll(
    kit.id(),
    { principalRef: internalId, method: "totp", secretRef: "totp:x" },
    kit.deps.idGenerator.generate(),
    kit.clock.now(),
  );
  enrollment.markVerified(kit.deps.idGenerator.generate(), kit.clock.now());
  await kit.mfaEnrollments.save(enrollment, T);
}

async function setPolicy(kit: StaffKit, mfaRequired: boolean): Promise<void> {
  await kit.tenantProfiles.save(
    TenantSecurityProfile.configure(
      kit.id(),
      T,
      { mfaRequired },
      kit.deps.idGenerator.generate(),
      kit.clock.now(),
    ),
    T,
  );
}

const login = (
  ctx: ReturnType<typeof build>,
  email: string,
  extra: {
    requireEnrolledFactor?: boolean;
    requireFactorEnrollment?: boolean;
    mfaSatisfied?: boolean;
  } = {},
) =>
  ctx.authenticate.execute({
    tenantId: T,
    method: "password",
    identifier: `staff:${email}`,
    credential: PASSWORD,
    ...extra,
  });

function outcome(result: Awaited<ReturnType<typeof login>>): AuthenticationOutcome {
  if (!result.ok) throw new Error(`unexpected failure ${result.error.message}`);
  return result.value;
}

const authAudits = async (kit: StaffKit) =>
  (await kit.deps.auditLedger.list(T, T)).filter(
    (r) => r.content.action === "security.auth.succeeded",
  );

describe("Authenticate requireEnrolledFactor", () => {
  it("enrolled + flag: no session, requirement required, hasActiveEnrollment, audit mfa=required", async () => {
    const ctx = build();
    const id = await seedMember(ctx, "p-1", "sam@x.com");
    await enrolActive(ctx.kit, id);

    const out = outcome(await login(ctx, "sam@x.com", { requireEnrolledFactor: true }));

    expect(out.authenticated).toBe(true);
    expect(out.sessionId).toBeNull();
    expect(out.mfaRequirement).toBe("required");
    expect(out.hasActiveEnrollment).toBe(true);
    const rows = await authAudits(ctx.kit);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content.metadata?.mfa).toBe("required");
    expect(await ctx.kit.sessions.listByPrincipal(id, T)).toHaveLength(0);
  });

  it("enrolled + flag + mfaSatisfied: the session is created", async () => {
    const ctx = build();
    const id = await seedMember(ctx, "p-1", "sam@x.com");
    await enrolActive(ctx.kit, id);

    const out = outcome(
      await login(ctx, "sam@x.com", { requireEnrolledFactor: true, mfaSatisfied: true }),
    );

    expect(out.sessionId).not.toBeNull();
    expect(out.hasActiveEnrollment).toBe(true);
  });

  it("enrolled without the flag: a session as today (customers unaffected), requirement optional", async () => {
    const ctx = build();
    const id = await seedMember(ctx, "p-1", "sam@x.com");
    await enrolActive(ctx.kit, id);

    const out = outcome(await login(ctx, "sam@x.com"));

    expect(out.sessionId).not.toBeNull();
    expect(out.mfaRequirement).toBe("optional");
    expect(out.hasActiveEnrollment).toBe(true);
    expect((await authAudits(ctx.kit))[0]!.content.metadata?.mfa).toBe("optional");
  });

  it("unenrolled + flag: a session, hasActiveEnrollment false", async () => {
    const ctx = build();
    await seedMember(ctx, "p-1", "sam@x.com");

    const out = outcome(await login(ctx, "sam@x.com", { requireEnrolledFactor: true }));

    expect(out.sessionId).not.toBeNull();
    expect(out.mfaRequirement).toBe("optional");
    expect(out.hasActiveEnrollment).toBe(false);
  });

  it("a pending (unconfirmed) enrolment does not count as enrolled", async () => {
    const ctx = build();
    const id = await seedMember(ctx, "p-1", "sam@x.com");
    await ctx.kit.mfaEnrollments.save(
      MfaEnrollment.enroll(
        ctx.kit.id(),
        { principalRef: id, method: "totp", secretRef: "totp:x" },
        ctx.kit.deps.idGenerator.generate(),
        ctx.kit.clock.now(),
      ),
      T,
    );

    const out = outcome(await login(ctx, "sam@x.com", { requireEnrolledFactor: true }));

    expect(out.sessionId).not.toBeNull();
    expect(out.hasActiveEnrollment).toBe(false);
  });

  it("a failed password reports hasActiveEnrollment false and no principal", async () => {
    const ctx = build();
    await seedMember(ctx, "p-1", "sam@x.com");

    const result = await ctx.authenticate.execute({
      tenantId: T,
      method: "password",
      identifier: "staff:sam@x.com",
      credential: "wrong",
      requireEnrolledFactor: true,
    });

    const out = outcome(result);
    expect(out.authenticated).toBe(false);
    expect(out.hasActiveEnrollment).toBe(false);
    expect(out.sessionId).toBeNull();
  });
});

describe("tenant policy profile lookup (staff-only tenantRef ?? tenantId)", () => {
  async function bootstrapOwner(ctx: ReturnType<typeof build>) {
    const owner = Principal.register(
      ctx.kit.id(),
      { externalId: "p-owner", kind: "human", displayName: "owner@x.com", subjectRef: "p-owner" },
      ctx.kit.deps.idGenerator.generate(),
      ctx.kit.clock.now(),
    );
    expect(owner.tenantRef).toBeNull();
    await ctx.kit.principals.save(owner, T);
    ctx.provider.register("staff:owner@x.com", PASSWORD, "p-owner");
    return owner.id.toString();
  }

  it("bootstrap owner (tenantRef null) with the policy on and no enrolment: required", async () => {
    const ctx = build();
    await bootstrapOwner(ctx);
    await setPolicy(ctx.kit, true);

    const out = outcome(await login(ctx, "owner@x.com", { requireEnrolledFactor: true }));

    expect(out.sessionId).toBeNull();
    expect(out.mfaRequirement).toBe("required");
    expect(out.hasActiveEnrollment).toBe(false);
  });

  it("bootstrap owner with the policy off: a session", async () => {
    const ctx = build();
    await bootstrapOwner(ctx);
    await setPolicy(ctx.kit, false);

    const out = outcome(await login(ctx, "owner@x.com", { requireEnrolledFactor: true }));

    expect(out.sessionId).not.toBeNull();
  });

  it("a member with tenantRef = tenantId still follows the policy", async () => {
    const ctx = build();
    await seedMember(ctx, "p-1", "sam@x.com");
    await setPolicy(ctx.kit, true);

    const out = outcome(await login(ctx, "sam@x.com", { requireEnrolledFactor: true }));

    expect(out.sessionId).toBeNull();
    expect(out.mfaRequirement).toBe("required");
  });

  it("customer (tenantRef null, no staff flag) signs in with the policy on: session, not required", async () => {
    const ctx = build();
    const customer = Principal.register(
      ctx.kit.id(),
      { externalId: "c-1", kind: "human", displayName: "cust@x.com", subjectRef: "c-1" },
      ctx.kit.deps.idGenerator.generate(),
      ctx.kit.clock.now(),
    );
    expect(customer.tenantRef).toBeNull();
    await ctx.kit.principals.save(customer, T);
    ctx.provider.register("customer:cust@x.com", PASSWORD, "c-1");
    await setPolicy(ctx.kit, true);

    const result = await ctx.authenticate.execute({
      tenantId: T,
      method: "password",
      identifier: "customer:cust@x.com",
      credential: PASSWORD,
    });
    const out = outcome(result);

    expect(out.authenticated).toBe(true);
    expect(out.sessionId).not.toBeNull();
    expect(out.mfaRequirement).not.toBe("required");
  });

  it("DecideMfa for a null-tenantRef principal is not required by the staff policy", async () => {
    const ctx = build();
    await bootstrapOwner(ctx);
    await setPolicy(ctx.kit, true);

    const decided = await ctx.decide.execute({
      tenantId: T,
      principalExternalId: "p-owner",
      riskBand: "low",
    });

    expect(decided.ok && decided.value.requirement).not.toBe("required");
  });
});

describe("Authenticate requireFactorEnrollment (Wave 1f, mandatory two-step)", () => {
  it("unenrolled + flag: no session, requirement required, hasActiveEnrollment false, audit mfa=required", async () => {
    const ctx = build();
    const id = await seedMember(ctx, "p-1", "sam@x.com");

    const out = outcome(await login(ctx, "sam@x.com", { requireFactorEnrollment: true }));

    expect(out.authenticated).toBe(true);
    expect(out.sessionId).toBeNull();
    expect(out.mfaRequirement).toBe("required");
    expect(out.hasActiveEnrollment).toBe(false);
    expect((await authAudits(ctx.kit))[0]!.content.metadata?.mfa).toBe("required");
    expect(await ctx.kit.sessions.listByPrincipal(id, T)).toHaveLength(0);
  });

  it("a claimed mfaSatisfied cannot stand in for the missing enrolment", async () => {
    const ctx = build();
    await seedMember(ctx, "p-1", "sam@x.com");

    const out = outcome(
      await login(ctx, "sam@x.com", { requireFactorEnrollment: true, mfaSatisfied: true }),
    );

    expect(out.sessionId).toBeNull();
    expect(out.mfaRequirement).toBe("required");
  });

  it("a pending (unconfirmed) enrolment is not an enrolment: still no session", async () => {
    const ctx = build();
    const id = await seedMember(ctx, "p-1", "sam@x.com");
    await ctx.kit.mfaEnrollments.save(
      MfaEnrollment.enroll(
        ctx.kit.id(),
        { principalRef: id, method: "totp", secretRef: "totp:x" },
        ctx.kit.deps.idGenerator.generate(),
        ctx.kit.clock.now(),
      ),
      T,
    );

    const out = outcome(await login(ctx, "sam@x.com", { requireFactorEnrollment: true }));

    expect(out.sessionId).toBeNull();
    expect(out.hasActiveEnrollment).toBe(false);
  });

  it("enrolled + both flags: the 1e code path (no session until mfaSatisfied)", async () => {
    const ctx = build();
    const id = await seedMember(ctx, "p-1", "sam@x.com");
    await enrolActive(ctx.kit, id);
    const both = { requireEnrolledFactor: true, requireFactorEnrollment: true };

    const first = outcome(await login(ctx, "sam@x.com", both));
    expect(first.sessionId).toBeNull();
    expect(first.mfaRequirement).toBe("required");
    expect(first.hasActiveEnrollment).toBe(true);

    const second = outcome(await login(ctx, "sam@x.com", { ...both, mfaSatisfied: true }));
    expect(second.sessionId).not.toBeNull();
  });

  it("flag absent: unchanged (an unenrolled member gets a session, as in 1e)", async () => {
    const ctx = build();
    await seedMember(ctx, "p-1", "sam@x.com");

    const out = outcome(await login(ctx, "sam@x.com", { requireEnrolledFactor: true }));

    expect(out.sessionId).not.toBeNull();
    expect(out.mfaRequirement).toBe("optional");
  });

  it("a customer principal that never passes the flag signs in, with the store policy on too", async () => {
    const ctx = build();
    const customer = Principal.register(
      ctx.kit.id(),
      { externalId: "c-1", kind: "human", displayName: "cust@x.com", subjectRef: "c-1" },
      ctx.kit.deps.idGenerator.generate(),
      ctx.kit.clock.now(),
    );
    await ctx.kit.principals.save(customer, T);
    ctx.provider.register("customer:cust@x.com", PASSWORD, "c-1");
    await setPolicy(ctx.kit, true);

    const out = outcome(
      await ctx.authenticate.execute({
        tenantId: T,
        method: "password",
        identifier: "customer:cust@x.com",
        credential: PASSWORD,
      }),
    );

    expect(out.authenticated).toBe(true);
    expect(out.sessionId).not.toBeNull();
    expect(out.hasActiveEnrollment).toBe(false);
  });

  it("a failed password with the flag stays a plain failure (no setup is offered)", async () => {
    const ctx = build();
    await seedMember(ctx, "p-1", "sam@x.com");

    const out = outcome(
      await ctx.authenticate.execute({
        tenantId: T,
        method: "password",
        identifier: "staff:sam@x.com",
        credential: "wrong",
        requireFactorEnrollment: true,
      }),
    );

    expect(out.authenticated).toBe(false);
    expect(out.sessionId).toBeNull();
  });
});
