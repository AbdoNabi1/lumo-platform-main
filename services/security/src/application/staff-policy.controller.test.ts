import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { describe, expect, it } from "vitest";
import { wireSecurity } from "../composition";
import { HashedPasswordAuthProvider } from "../infrastructure/hashed-password-auth-provider";
import { InMemoryPasswordCredentialStore } from "../infrastructure/in-memory-password-credential-store";
import { ScryptPasswordHasher } from "../infrastructure/scrypt-password-hasher";

const T = "shop-a";
let now = new Date("2026-11-27T10:00:10.000Z");
const clock: Clock = { now: () => now };

function wire() {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  return wireSecurity({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    knownSubjects: ["p-owner", "p-new"],
    mfaConfigured: true,
    passwordAuthProvider: new HashedPasswordAuthProvider({
      store: new InMemoryPasswordCredentialStore(),
      hasher: new ScryptPasswordHasher({ log2N: 10 }),
      clock,
    }),
  });
}

async function seedOwner(wired: ReturnType<typeof wire>) {
  await wired.security.registerPrincipal({
    tenantId: T,
    externalId: "p-owner",
    kind: "human",
    displayName: "owner@x.com",
    subjectRef: "p-owner",
    tenantRef: T,
  });
  await wired.security.defineRole({ tenantId: T, key: "platform-admin", name: "Owner" });
  await wired.security.assignRole({
    tenantId: T,
    principalExternalId: "p-owner",
    roleKey: "platform-admin",
    grantedBy: "test",
  });
  await wired.passwordRegistrar.setPassword({
    tenantId: T,
    identifier: "staff:owner@x.com",
    password: "correct horse 1",
    principalExternalId: "p-owner",
  });
}

describe("SecurityController — staff policy and activity", () => {
  it("get → refused enable (409, exact message) → own two-step → enable → get → activity → policy blocks inviting", async () => {
    now = new Date("2026-11-27T10:00:10.000Z");
    const wired = wire();
    const { security } = wired;
    await seedOwner(wired);

    const before = await security.getStaffSecurityPolicy({ tenantId: T, codeStepAvailable: true });
    expect(before.status).toBe(200);
    expect(before.body).toEqual({
      requireTwoStep: false,
      codeStepAvailable: true,
      activeStaff: 1,
      enrolledActiveStaff: 0,
      notEnrolled: [{ principalExternalId: "p-owner", email: "owner@x.com" }],
      pendingInvitations: 0,
    });

    const refused = await security.setRequireTwoStep({
      tenantId: T,
      actorExternalId: "p-owner",
      enabled: true,
      codeStepAvailable: true,
    });
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain(
      "Turn on two-step verification for your own account first",
    );

    const started = (
      await security.startOwnTwoStep({
        tenantId: T,
        principalExternalId: "p-owner",
        email: "owner@x.com",
      })
    ).body as { enrollmentId: string };
    expect(
      (
        await security.confirmOwnTwoStep({
          tenantId: T,
          principalExternalId: "p-owner",
          enrollmentId: started.enrollmentId,
          code: "123456",
          now,
        })
      ).status,
    ).toBe(200);
    now = new Date(now.getTime() + 60_000);

    const enabled = await security.setRequireTwoStep({
      tenantId: T,
      actorExternalId: "p-owner",
      enabled: true,
      codeStepAvailable: true,
    });
    expect(enabled.status).toBe(200);
    expect(enabled.body).toEqual({ requireTwoStep: true });
    const after = await security.getStaffSecurityPolicy({ tenantId: T, codeStepAvailable: true });
    expect(after.body).toMatchObject({
      requireTwoStep: true,
      enrolledActiveStaff: 1,
      notEnrolled: [],
    });

    const invite = await security.createStaffInvitation({
      tenantId: T,
      actorExternalId: "p-owner",
      principalExternalId: "p-new",
      email: "new@x.com",
      role: "viewer",
      tokenHash: "a".repeat(64),
      now,
    });
    expect(invite.status).toBe(409);

    const activity = await security.listStaffActivity({ tenantId: T });
    expect(activity.status).toBe(200);
    const body = activity.body as { items: Array<{ kind: string }>; nextCursor: string | null };
    expect(body.items.map((i) => i.kind)).toEqual(["two_step_policy_changed", "two_step_on"]);
    expect(body.nextCursor).toBeNull();

    expect((await security.listStaffActivity({ tenantId: T, cursor: "!!" })).status).toBe(422);
    expect((await security.listStaffActivity({ tenantId: T, limit: 51 })).status).toBe(422);
  });

  it("the staff list carries twoStep per member", async () => {
    now = new Date("2026-11-27T10:00:10.000Z");
    const wired = wire();
    await seedOwner(wired);
    const before = await wired.security.listStaff({
      tenantId: T,
      actorExternalId: "p-owner",
      now,
    });
    expect((before.body as { items: Array<{ twoStep: boolean }> }).items[0]?.twoStep).toBe(false);
    const started = (
      await wired.security.startOwnTwoStep({
        tenantId: T,
        principalExternalId: "p-owner",
        email: "owner@x.com",
      })
    ).body as { enrollmentId: string };
    await wired.security.confirmOwnTwoStep({
      tenantId: T,
      principalExternalId: "p-owner",
      enrollmentId: started.enrollmentId,
      code: "123456",
      now,
    });
    const after = await wired.security.listStaff({ tenantId: T, actorExternalId: "p-owner", now });
    expect((after.body as { items: Array<{ twoStep: boolean }> }).items[0]?.twoStep).toBe(true);
  });
});
