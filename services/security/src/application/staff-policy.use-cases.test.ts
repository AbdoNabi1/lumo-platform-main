import { UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { describe, expect, it } from "vitest";
import { MfaEnrollment } from "../domain/mfa-enrollment";
import type { StaffMutationLock } from "../domain/repositories";
import { TenantSecurityProfile } from "../domain/tenant-security-profile";
import { InMemoryTotpMfaProvider } from "../infrastructure/in-memory-auth-adapters";
import { InMemoryStaffMutationLock } from "../infrastructure/in-memory-staff-mutation-lock";
import { buildStaffKit, type StaffKit } from "../infrastructure/staff-test-kit";
import { DisableOwnTwoStep } from "./own-mfa.use-cases";
import {
  AcceptStaffInvitation,
  CreateStaffInvitation,
  SetStaffActive,
} from "./staff-commands.use-cases";
import { GetStaffSecurityPolicy, SetRequireTwoStep } from "./staff-policy.use-cases";
import { ListStaff } from "./staff.use-cases";

const T = "shop-a";
const OTHER = "shop-b";
const hash = (c: string): string => c.repeat(64);

function failure<V>(result: Result<V, DomainError>): DomainError {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.value)}`);
  return result.error;
}
function value<V>(result: Result<V, DomainError>): V {
  if (!result.ok)
    throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** Turns two-step on for a seeded member (an ACTIVE totp enrolment, no ceremony). */
async function enrol(kit: StaffKit, internalId: string, tenant = T): Promise<void> {
  const enrollment = MfaEnrollment.enroll(
    UniqueEntityId.from(kit.deps.idGenerator.generate()),
    { principalRef: internalId, method: "totp", secretRef: "secret-ref" },
    kit.deps.idGenerator.generate(),
    kit.clock.now(),
  );
  enrollment.markVerified(kit.deps.idGenerator.generate(), kit.clock.now());
  await kit.mfaEnrollments.save(enrollment, tenant);
}

async function cast(kit: StaffKit) {
  const owner = await kit.seedStaff(T, {
    externalId: "p-owner",
    email: "owner@x.com",
    roles: ["platform-admin"],
  });
  const admin = await kit.seedStaff(T, {
    externalId: "p-admin",
    email: "admin@x.com",
    roles: ["admin"],
  });
  const op = await kit.seedStaff(T, { externalId: "p-op", email: "op@x.com", roles: ["operator"] });
  return { owner, admin, op };
}

const set = (
  kit: StaffKit,
  input: { actor?: string; enabled: boolean; codeStepAvailable?: boolean; tenant?: string },
) =>
  new SetRequireTwoStep(kit.deps).execute({
    tenantId: input.tenant ?? T,
    actorExternalId: input.actor ?? "p-owner",
    enabled: input.enabled,
    codeStepAvailable: input.codeStepAvailable ?? true,
  });
const get = (kit: StaffKit, codeStepAvailable = true, tenant = T) =>
  new GetStaffSecurityPolicy(kit.deps).execute({ tenantId: tenant, codeStepAvailable });
const profileOf = (kit: StaffKit, tenant = T) => kit.tenantProfiles.findByTenant(tenant, tenant);
const audits = async (kit: StaffKit, tenant = T) =>
  (await kit.deps.auditLedger.list(tenant, tenant)).map((r) => r.content);

/** Everyone enrolled: the state in which the policy may be switched on. */
async function allEnrolled(kit: StaffKit) {
  const ids = await cast(kit);
  for (const id of [ids.owner, ids.admin, ids.op]) await enrol(kit, id);
  return ids;
}

describe("ListStaff twoStep", () => {
  it("is true only for members with an ACTIVE totp enrolment; invitee, pending and revoked are false", async () => {
    const kit = buildStaffKit();
    const ids = await cast(kit);
    const viewer = await kit.seedStaff(T, {
      externalId: "p-view",
      email: "view@x.com",
      roles: ["viewer"],
    });
    await enrol(kit, ids.owner);
    await enrol(kit, ids.admin);
    // a pending (unconfirmed) enrolment does not count
    await kit.mfaEnrollments.save(
      MfaEnrollment.enroll(
        UniqueEntityId.from(kit.deps.idGenerator.generate()),
        { principalRef: ids.op, method: "totp", secretRef: "s" },
        kit.deps.idGenerator.generate(),
        kit.clock.now(),
      ),
      T,
    );
    // a revoked enrolment does not count
    const revoked = MfaEnrollment.enroll(
      UniqueEntityId.from(kit.deps.idGenerator.generate()),
      { principalRef: viewer, method: "totp", secretRef: "s" },
      kit.deps.idGenerator.generate(),
      kit.clock.now(),
    );
    revoked.markVerified(kit.deps.idGenerator.generate(), kit.clock.now());
    revoked.revoke(kit.deps.idGenerator.generate(), kit.clock.now());
    await kit.mfaEnrollments.save(revoked, T);
    const invite = await new CreateStaffInvitation(kit.deps).execute({
      tenantId: T,
      actorExternalId: "p-owner",
      principalExternalId: "p-new",
      email: "new@x.com",
      role: "viewer",
      tokenHash: hash("a"),
      now: kit.clock.now(),
    });
    value(invite);

    const items = value(
      await new ListStaff(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-owner",
        now: kit.clock.now(),
      }),
    ).items;
    const byEmail = Object.fromEntries(items.map((i) => [i.email, i.twoStep]));
    expect(byEmail).toEqual({
      "owner@x.com": true,
      "admin@x.com": true,
      "op@x.com": false,
      "view@x.com": false,
      "new@x.com": false,
    });
  });

  it("an enrolment of another tenant never counts", async () => {
    const kit = buildStaffKit();
    const ids = await cast(kit);
    await enrol(kit, ids.owner, OTHER);
    const items = value(
      await new ListStaff(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-owner",
        now: kit.clock.now(),
      }),
    ).items;
    expect(items.every((i) => i.twoStep === false)).toBe(true);
  });
});

describe("GetStaffSecurityPolicy", () => {
  it("no profile → off; counts, the not-enrolled list (sorted by email) and pending invitations", async () => {
    const kit = buildStaffKit();
    const ids = await cast(kit);
    await enrol(kit, ids.owner);
    await kit.seedStaff(T, {
      externalId: "p-susp",
      email: "susp@x.com",
      roles: ["viewer"],
      status: "suspended",
    });
    value(
      await new CreateStaffInvitation(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-owner",
        principalExternalId: "p-new",
        email: "new@x.com",
        role: "viewer",
        tokenHash: hash("b"),
        now: kit.clock.now(),
      }),
    );
    expect(value(await get(kit, false))).toEqual({
      requireTwoStep: false,
      codeStepAvailable: false,
      activeStaff: 3,
      enrolledActiveStaff: 1,
      notEnrolled: [
        { principalExternalId: "p-admin", email: "admin@x.com" },
        { principalExternalId: "p-op", email: "op@x.com" },
      ],
      pendingInvitations: 1,
    });
  });

  it("reports the stored flag and the code-step capability flag", async () => {
    const kit = buildStaffKit();
    await allEnrolled(kit);
    value(await set(kit, { enabled: true }));
    const policy = value(await get(kit, true));
    expect(policy.requireTwoStep).toBe(true);
    expect(policy.codeStepAvailable).toBe(true);
    expect(policy.notEnrolled).toEqual([]);
    expect(policy.enrolledActiveStaff).toBe(policy.activeStaff);
  });

  it("another tenant's staff, enrolments, invitations and profile are invisible", async () => {
    const kit = buildStaffKit();
    await allEnrolled(kit);
    value(await set(kit, { enabled: true }));
    const policy = value(await get(kit, true, OTHER));
    expect(policy).toMatchObject({
      requireTwoStep: false,
      activeStaff: 0,
      enrolledActiveStaff: 0,
      notEnrolled: [],
      pendingInvitations: 0,
    });
  });
});

describe("SetRequireTwoStep — refusals (exact order and messages)", () => {
  it("1. code step not available", async () => {
    const kit = buildStaffKit();
    await allEnrolled(kit);
    const error = failure(await set(kit, { enabled: true, codeStepAvailable: false }));
    expect(error.code).toBe("BUSINESS_RULE");
    expect(error.message).toBe("Two-step sign-in isn't available on this server yet");
  });

  it("2. the actor has no two-step (beats 'everyone' even though everyone else is missing too)", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    const error = failure(await set(kit, { enabled: true }));
    expect(error.message).toBe("Turn on two-step verification for your own account first");
  });

  it("3. an active member has none", async () => {
    const kit = buildStaffKit();
    const ids = await cast(kit);
    await enrol(kit, ids.owner);
    const error = failure(await set(kit, { enabled: true }));
    expect(error.code).toBe("BUSINESS_RULE");
    expect(error.message).toBe("Everyone needs two-step verification turned on first");
  });

  it("4. a pending invitation exists (everyone else enrolled)", async () => {
    const kit = buildStaffKit();
    await allEnrolled(kit);
    value(
      await new CreateStaffInvitation(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-owner",
        principalExternalId: "p-new",
        email: "new@x.com",
        role: "viewer",
        tokenHash: hash("c"),
        now: kit.clock.now(),
      }),
    );
    const error = failure(await set(kit, { enabled: true }));
    expect(error.message).toBe("Revoke or wait for pending invitations first");
  });

  it("an EXPIRED pending invitation still blocks", async () => {
    const kit = buildStaffKit();
    await allEnrolled(kit);
    value(
      await new CreateStaffInvitation(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-owner",
        principalExternalId: "p-new",
        email: "new@x.com",
        role: "viewer",
        tokenHash: hash("c"),
        now: kit.clock.now(),
      }),
    );
    kit.clock.advance(8 * 24 * 3600_000);
    expect(failure(await set(kit, { enabled: true })).message).toBe(
      "Revoke or wait for pending invitations first",
    );
  });

  it("a deactivated (suspended) member without two-step does not block", async () => {
    const kit = buildStaffKit();
    await allEnrolled(kit);
    await kit.seedStaff(T, {
      externalId: "p-susp",
      email: "susp@x.com",
      roles: ["viewer"],
      status: "suspended",
    });
    expect(value(await set(kit, { enabled: true }))).toEqual({ requireTwoStep: true });
  });

  it("every refusal leaves the profile and the audit ledger untouched", async () => {
    const kit = buildStaffKit();
    const ids = await cast(kit);
    await enrol(kit, ids.owner);
    const before = await kit.snapshot(T);
    failure(await set(kit, { enabled: true }));
    failure(await set(kit, { enabled: true, codeStepAvailable: false }));
    expect(await kit.snapshot(T)).toBe(before);
    expect(await profileOf(kit)).toBeNull();
  });

  it("a non-admin or inactive actor is refused (403), nothing written", async () => {
    const kit = buildStaffKit();
    await allEnrolled(kit);
    await kit.seedStaff(T, { externalId: "p-view", email: "view@x.com", roles: ["viewer"] });
    await kit.seedStaff(T, {
      externalId: "p-gone",
      email: "gone@x.com",
      roles: ["admin"],
      status: "suspended",
    });
    for (const actor of ["p-op", "p-view", "p-gone", "p-nobody"]) {
      const error = failure(await set(kit, { actor, enabled: true }));
      expect(error.code).toBe("FORBIDDEN");
    }
    expect(await profileOf(kit)).toBeNull();
    expect(await audits(kit)).toEqual([]);
  });

  it("a non-boolean flag is a validation error on `enabled`", async () => {
    const kit = buildStaffKit();
    await allEnrolled(kit);
    const result = await new SetRequireTwoStep(kit.deps).execute({
      tenantId: T,
      actorExternalId: "p-owner",
      enabled: "yes" as unknown as boolean,
      codeStepAvailable: true,
    });
    const error = failure(result);
    expect(error.code).toBe("VALIDATION");
    expect(await profileOf(kit)).toBeNull();
  });
});

describe("SetRequireTwoStep — writes", () => {
  it("creates the profile keyed tenantRef = tenantId when absent, audits {actor,target,enabled}", async () => {
    const kit = buildStaffKit();
    await allEnrolled(kit);
    expect(await profileOf(kit)).toBeNull();
    expect(value(await set(kit, { enabled: true }))).toEqual({ requireTwoStep: true });
    const profile = await profileOf(kit);
    expect(profile?.tenantRef).toBe(T);
    expect(profile?.mfaRequired).toBe(true);
    const rows = await audits(kit);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "security.staff.two_step_policy_changed",
      principalRef: "p-owner",
      decision: "allow",
      tenantRef: T,
      metadata: { actor: "p-owner", target: "p-owner", enabled: "true" },
    });
    expect(Object.keys(rows[0]!.metadata).sort()).toEqual(["actor", "enabled", "target"]);
  });

  it("keeps the existing profile's other fields", async () => {
    const kit = buildStaffKit();
    await allEnrolled(kit);
    await kit.tenantProfiles.save(
      TenantSecurityProfile.configure(
        UniqueEntityId.from(kit.deps.idGenerator.generate()),
        T,
        {
          securityMode: "strict",
          residencyRegion: "eu",
          allowedAuthMethods: ["password", "totp"],
          defaultPolicyKey: "baseline",
        },
        kit.deps.idGenerator.generate(),
        kit.clock.now(),
      ),
      T,
    );
    value(await set(kit, { enabled: true }));
    const profile = await profileOf(kit);
    expect(profile).toMatchObject({
      mfaRequired: true,
      securityMode: "strict",
      residencyRegion: "eu",
      defaultPolicyKey: "baseline",
    });
    expect([...(profile?.allowedAuthMethods ?? [])]).toEqual(["password", "totp"]);
  });

  it("turning it off is always allowed — even when nobody has two-step and the code step is down", async () => {
    const kit = buildStaffKit();
    await allEnrolled(kit);
    value(await set(kit, { enabled: true }));
    // the world changes: someone loses their enrolment, a pending invite is created directly
    const owner = await kit.principals.findByExternalId("p-owner", T);
    const [enrolment] = await kit.mfaEnrollments.listByPrincipal(owner!.id.toString(), T);
    enrolment!.revoke(kit.deps.idGenerator.generate(), kit.clock.now());
    await kit.mfaEnrollments.save(enrolment!, T);
    expect(value(await set(kit, { enabled: false, codeStepAvailable: false }))).toEqual({
      requireTwoStep: false,
    });
    expect((await profileOf(kit))?.mfaRequired).toBe(false);
    const rows = await audits(kit);
    expect(rows.map((r) => r.metadata["enabled"])).toEqual(["true", "false"]);
  });

  it("turning off when nothing is on creates no profile and no audit row; same-value on is a no-op", async () => {
    const kit = buildStaffKit();
    await allEnrolled(kit);
    expect(value(await set(kit, { enabled: false }))).toEqual({ requireTwoStep: false });
    expect(await profileOf(kit)).toBeNull();
    value(await set(kit, { enabled: true }));
    expect(value(await set(kit, { enabled: true }))).toEqual({ requireTwoStep: true });
    expect(await audits(kit)).toHaveLength(1);
  });

  it("an admin (not just the owner) may toggle", async () => {
    const kit = buildStaffKit();
    await allEnrolled(kit);
    expect(value(await set(kit, { actor: "p-admin", enabled: true }))).toEqual({
      requireTwoStep: true,
    });
  });

  it("the toggle of one store never reaches another", async () => {
    const kit = buildStaffKit();
    await allEnrolled(kit);
    value(await set(kit, { enabled: true }));
    expect(await profileOf(kit, OTHER)).toBeNull();
  });

  it("runs inside the tenant staff lock", async () => {
    const taken: string[] = [];
    const inner = new InMemoryStaffMutationLock();
    const lock: StaffMutationLock = {
      withTenantStaffLock: (tenantId, tx, body) => {
        taken.push(tenantId);
        return inner.withTenantStaffLock(tenantId, tx, body);
      },
    };
    const kit = buildStaffKit({ lock });
    await allEnrolled(kit);
    value(await set(kit, { enabled: true }));
    expect(taken).toEqual([T]);
  });
});

describe("while requireTwoStep is on", () => {
  async function policyOn() {
    const kit = buildStaffKit();
    await allEnrolled(kit);
    const viewer = await kit.seedStaff(T, {
      externalId: "p-view",
      email: "view@x.com",
      roles: ["viewer"],
      status: "suspended",
    });
    value(await set(kit, { enabled: true }));
    return { kit, viewer };
  }
  const invite = (kit: StaffKit) =>
    new CreateStaffInvitation(kit.deps).execute({
      tenantId: T,
      actorExternalId: "p-owner",
      principalExternalId: "p-new",
      email: "new@x.com",
      role: "viewer",
      tokenHash: hash("d"),
      now: kit.clock.now(),
    });

  it("inviting is refused with the exact message and writes nothing", async () => {
    const { kit } = await policyOn();
    const before = await kit.snapshot(T);
    const error = failure(await invite(kit));
    expect(error.code).toBe("BUSINESS_RULE");
    expect(error.message).toBe(
      "Your store requires two-step verification. Turn that off before inviting people",
    );
    expect(await kit.snapshot(T)).toBe(before);
  });

  it("reactivating is refused; deactivating still works", async () => {
    const { kit } = await policyOn();
    const before = await kit.snapshot(T);
    const error = failure(
      await new SetStaffActive(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-owner",
        targetExternalId: "p-view",
        active: true,
      }),
    );
    expect(error.message).toBe(
      "Your store requires two-step verification. Turn that off before reactivating people",
    );
    expect(await kit.snapshot(T)).toBe(before);
    expect(
      value(
        await new SetStaffActive(kit.deps).execute({
          tenantId: T,
          actorExternalId: "p-owner",
          targetExternalId: "p-op",
          active: false,
        }),
      ),
    ).toEqual({ status: "deactivated" });
  });

  it("accepting an invitation is refused (the invite was created while the policy was off)", async () => {
    const kit = buildStaffKit();
    await allEnrolled(kit);
    value(await invite(kit));
    // the policy gets switched on directly (as if enabled before this invitation existed on another path)
    await kit.tenantProfiles.save(
      TenantSecurityProfile.configure(
        UniqueEntityId.from(kit.deps.idGenerator.generate()),
        T,
        { mfaRequired: true },
        kit.deps.idGenerator.generate(),
        kit.clock.now(),
      ),
      T,
    );
    const before = await kit.snapshot(T);
    const error = failure(
      await new AcceptStaffInvitation(kit.deps).execute({
        tenantId: T,
        tokenHash: hash("d"),
        password: "correct horse battery",
        now: kit.clock.now(),
      }),
    );
    expect(error.message).toBe(
      "This invitation can't be accepted while the store requires two-step verification. Ask the store admin.",
    );
    expect(await kit.snapshot(T)).toBe(before);
    expect(await kit.staffCredentials.find(T, "staff:new@x.com")).toBeNull();
  });

  it("a garbage token learns nothing about the policy (same generic message)", async () => {
    const { kit } = await policyOn();
    const error = failure(
      await new AcceptStaffInvitation(kit.deps).execute({
        tenantId: T,
        tokenHash: hash("e"),
        password: "correct horse battery",
        now: kit.clock.now(),
      }),
    );
    expect(error.message).toBe("This invitation is no longer valid");
  });

  it("own turn-off is refused from the SAME flag (set through SetRequireTwoStep)", async () => {
    const { kit } = await policyOn();
    const deps = kit.mfaDeps(new InMemoryTotpMfaProvider());
    const error = failure(
      await new DisableOwnTwoStep(deps).execute({
        tenantId: T,
        principalExternalId: "p-op",
        now: kit.clock.now(),
      }),
    );
    expect(error.message).toBe(
      "Your store requires two-step verification, so it can't be turned off",
    );
    // …and works again after the policy is turned off
    value(await set(kit, { enabled: false }));
    expect(
      value(
        await new DisableOwnTwoStep(deps).execute({
          tenantId: T,
          principalExternalId: "p-op",
          now: kit.clock.now(),
        }),
      ),
    ).toEqual({ enabled: false });
  });

  it("after turning the policy off, invite / reactivate / accept work again", async () => {
    const { kit } = await policyOn();
    value(await set(kit, { enabled: false }));
    value(await invite(kit));
    value(
      await new AcceptStaffInvitation(kit.deps).execute({
        tenantId: T,
        tokenHash: hash("d"),
        password: "correct horse battery",
        now: kit.clock.now(),
      }),
    );
    expect(
      value(
        await new SetStaffActive(kit.deps).execute({
          tenantId: T,
          actorExternalId: "p-owner",
          targetExternalId: "p-view",
          active: true,
        }),
      ),
    ).toEqual({ status: "active" });
  });

  it("another store's policy never blocks this one", async () => {
    const kit = buildStaffKit();
    await allEnrolled(kit);
    value(await set(kit, { enabled: true }));
    await kit.seedStaff(OTHER, {
      externalId: "o-admin",
      email: "admin@other.com",
      roles: ["admin"],
    });
    const result = await new CreateStaffInvitation(kit.deps).execute({
      tenantId: OTHER,
      actorExternalId: "o-admin",
      principalExternalId: "o-new",
      email: "new@other.com",
      role: "viewer",
      tokenHash: hash("f"),
      now: kit.clock.now(),
    });
    value(result);
  });
});
