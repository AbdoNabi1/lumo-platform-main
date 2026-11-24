import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { describe, expect, it } from "vitest";
import { wireSecurity } from "../composition";
import { HashedPasswordAuthProvider } from "../infrastructure/hashed-password-auth-provider";
import { InMemoryPasswordCredentialStore } from "../infrastructure/in-memory-password-credential-store";
import { ScryptPasswordHasher } from "../infrastructure/scrypt-password-hasher";

const T = "shop-a";
const clock: Clock = { now: () => new Date("2026-11-27T10:00:00.000Z") };

function wire(knownSubjects: readonly string[] = []) {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  return wireSecurity({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    knownSubjects,
    passwordAuthProvider: new HashedPasswordAuthProvider({
      store: new InMemoryPasswordCredentialStore(),
      hasher: new ScryptPasswordHasher({ log2N: 10 }),
      clock,
    }),
  });
}

/** Seeds a staff member through the public controller + registrar, the way owner bootstrap does. */
async function seed(
  wired: ReturnType<typeof wire>,
  externalId: string,
  email: string,
  roleKey: string,
) {
  await wired.security.registerPrincipal({
    tenantId: T,
    externalId,
    kind: "human",
    displayName: email,
    subjectRef: externalId,
  });
  await wired.security.defineRole({ tenantId: T, key: roleKey, name: roleKey });
  await wired.security.assignRole({
    tenantId: T,
    principalExternalId: externalId,
    roleKey,
    grantedBy: "test",
  });
  await wired.passwordRegistrar.setPassword({
    tenantId: T,
    identifier: `staff:${email}`,
    password: "correct horse 1",
    principalExternalId: externalId,
  });
}

describe("SecurityController — staff reads", () => {
  it("listStaff answers 200 with the staff of the store (credential store shared with the hashed provider)", async () => {
    const wired = wire(["owner-1", "op-1", "cust-1"]);
    await seed(wired, "owner-1", "owner@x.com", "platform-admin");
    await seed(wired, "op-1", "op@x.com", "operator");
    // a customer: principal + role-less, no staff: credential
    await wired.security.registerPrincipal({
      tenantId: T,
      externalId: "cust-1",
      kind: "human",
      displayName: "c",
      subjectRef: "cust-1",
    });
    const response = await wired.security.listStaff({
      tenantId: T,
      actorExternalId: "op-1",
      now: clock.now(),
    });
    expect(response.status).toBe(200);
    const items = (response.body as { items: { email: string; role: string; isSelf: boolean }[] })
      .items;
    expect(items.map((i) => [i.email, i.role, i.isSelf])).toEqual([
      ["owner@x.com", "owner", false],
      ["op@x.com", "operator", true],
    ]);
  });

  it("staffAccess answers 200 { status, roleKeys } and 404 for an unknown principal", async () => {
    const wired = wire(["owner-1"]);
    await seed(wired, "owner-1", "owner@x.com", "platform-admin");
    expect(
      await wired.security.staffAccess({ tenantId: T, principalExternalId: "owner-1" }),
    ).toEqual({
      status: 200,
      body: { status: "active", roleKeys: ["platform-admin"] },
    });
    const missing = await wired.security.staffAccess({
      tenantId: T,
      principalExternalId: "nobody",
    });
    expect(missing.status).toBe(404);
    const otherTenant = await wired.security.staffAccess({
      tenantId: "shop-b",
      principalExternalId: "owner-1",
    });
    expect(otherTenant.status).toBe(404);
  });
});

describe("SecurityController — staff writes (wired, hashed provider)", () => {
  const sha = (c: string): string => c.repeat(64);

  async function store() {
    const wired = wire(["owner-1", "op-1", "view-1"]);
    await wired.security.registerAuthMethod({
      tenantId: T,
      kind: "password",
      displayName: "Password",
    });
    await seed(wired, "owner-1", "owner@x.com", "platform-admin");
    await seed(wired, "op-1", "op@x.com", "operator");
    await seed(wired, "view-1", "view@x.com", "viewer");
    return wired;
  }
  const signIn = async (wired: ReturnType<typeof wire>, email: string, password: string) =>
    (
      (
        await wired.security.authenticate({
          tenantId: T,
          method: "password",
          identifier: `staff:${email}`,
          credential: password,
        })
      ).body as { authenticated: boolean }
    ).authenticated;
  const invite = (wired: ReturnType<typeof wire>, over: Record<string, unknown> = {}) =>
    wired.security.createStaffInvitation({
      tenantId: T,
      actorExternalId: "owner-1",
      principalExternalId: "inv-1",
      email: "Sam@X.com",
      role: "operator",
      tokenHash: sha("a"),
      now: clock.now(),
      ...over,
    });

  it("invite → 201; the password is unusable until accept (200); then sign-in works and the role is live", async () => {
    const wired = await store();
    const created = await invite(wired);
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      invitationId: expect.any(String),
      principalExternalId: "inv-1",
      identifier: "staff:sam@x.com",
    });
    expect(await signIn(wired, "sam@x.com", "correct horse 1")).toBe(false);
    const listed = await wired.security.listStaff({
      tenantId: T,
      actorExternalId: "owner-1",
      now: clock.now(),
    });
    const sam = (listed.body as { items: { email: string; status: string }[] }).items.find(
      (i) => i.email === "sam@x.com",
    );
    expect(sam?.status).toBe("invited");

    const accepted = await wired.security.acceptStaffInvitation({
      tenantId: T,
      tokenHash: sha("a"),
      password: "correct horse 1",
      now: clock.now(),
    });
    expect(accepted).toEqual({
      status: 200,
      body: { principalExternalId: "inv-1", email: "sam@x.com" },
    });
    expect(await signIn(wired, "sam@x.com", "correct horse 1")).toBe(true);
    expect(await wired.security.staffAccess({ tenantId: T, principalExternalId: "inv-1" })).toEqual(
      {
        status: 200,
        body: { status: "active", roleKeys: ["operator"] },
      },
    );
    // the used token is dead
    expect(
      (
        await wired.security.acceptStaffInvitation({
          tenantId: T,
          tokenHash: sha("a"),
          password: "correct horse 2",
          now: clock.now(),
        })
      ).status,
    ).toBe(409);
  });

  it("renew → 200 and the old token dies; revoke → 200 and the same email can be invited again (201)", async () => {
    const wired = await store();
    const created = (await invite(wired)).body as { invitationId: string };
    const renewed = await wired.security.renewStaffInvitation({
      tenantId: T,
      actorExternalId: "owner-1",
      invitationId: created.invitationId,
      expectedVersion: 1,
      tokenHash: sha("b"),
      now: clock.now(),
    });
    expect(renewed).toEqual({
      status: 200,
      body: { invitationId: created.invitationId, version: 2, email: "sam@x.com" },
    });
    const stale = await wired.security.acceptStaffInvitation({
      tenantId: T,
      tokenHash: sha("a"),
      password: "correct horse 1",
      now: clock.now(),
    });
    expect(stale.status).toBe(409);
    const revoked = await wired.security.revokeStaffInvitation({
      tenantId: T,
      actorExternalId: "owner-1",
      invitationId: created.invitationId,
      expectedVersion: 2,
      now: clock.now(),
    });
    expect(revoked).toEqual({
      status: 200,
      body: {
        invitationId: created.invitationId,
        email: "sam@x.com",
        principalExternalId: "inv-1",
      },
    });
    expect(
      (await invite(wired, { principalExternalId: "inv-2", tokenHash: sha("c") })).status,
    ).toBe(201);
    const accepted = await wired.security.acceptStaffInvitation({
      tenantId: T,
      tokenHash: sha("c"),
      password: "correct horse 1",
      now: clock.now(),
    });
    expect(accepted.status).toBe(200);
    expect(await signIn(wired, "sam@x.com", "correct horse 1")).toBe(true);
  });

  it("changeStaffRole / setStaffActive map outcomes to 200, 403, 404, 409, 422", async () => {
    const wired = await store();
    const change = (over: Record<string, unknown>) =>
      wired.security.changeStaffRole({
        tenantId: T,
        actorExternalId: "owner-1",
        targetExternalId: "op-1",
        role: "viewer",
        ...over,
      });
    expect(await change({})).toEqual({ status: 200, body: { role: "viewer" } });
    expect((await change({ targetExternalId: "owner-1", actorExternalId: "op-1" })).status).toBe(
      403,
    );
    expect((await change({ targetExternalId: "ghost" })).status).toBe(404);
    expect((await change({ targetExternalId: "owner-1" })).status).toBe(409);
    expect((await change({ role: "platform-admin" })).status).toBe(422);
    const active = (over: Record<string, unknown>) =>
      wired.security.setStaffActive({
        tenantId: T,
        actorExternalId: "owner-1",
        targetExternalId: "view-1",
        active: false,
        ...over,
      });
    expect(await active({})).toEqual({ status: 200, body: { status: "deactivated" } });
    expect(
      await wired.security.staffAccess({ tenantId: T, principalExternalId: "view-1" }),
    ).toEqual({
      status: 200,
      body: { status: "suspended", roleKeys: ["viewer"] },
    });
    expect(await active({ active: true })).toEqual({ status: 200, body: { status: "active" } });
    expect((await active({ targetExternalId: "owner-1" })).status).toBe(409);
    expect((await invite(wired, { email: "bad" })).status).toBe(422);
    expect((await invite(wired, { email: "view@x.com" })).status).toBe(409);
  });

  it("without an injected password provider the staff reads and invitations still work on the reference store", async () => {
    let n = 0;
    const wired = wireSecurity({
      serializer: new InMemoryEventSerializer(),
      idGenerator: {
        generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
      },
      clock,
      knownSubjects: ["owner-1"],
    });
    await wired.security.registerPrincipal({
      tenantId: T,
      externalId: "owner-1",
      kind: "human",
      displayName: "o",
      subjectRef: "owner-1",
    });
    await wired.security.defineRole({ tenantId: T, key: "platform-admin", name: "Owner" });
    await wired.security.assignRole({
      tenantId: T,
      principalExternalId: "owner-1",
      roleKey: "platform-admin",
      grantedBy: "test",
    });
    const response = await wired.security.createStaffInvitation({
      tenantId: T,
      actorExternalId: "owner-1",
      principalExternalId: "inv-1",
      email: "sam@x.com",
      role: "viewer",
      tokenHash: "a".repeat(64),
      now: clock.now(),
    });
    expect(response.status).toBe(201);
    const listed = await wired.security.listStaff({
      tenantId: T,
      actorExternalId: "owner-1",
      now: clock.now(),
    });
    expect((listed.body as { items: { email: string }[] }).items.map((i) => i.email)).toEqual([
      "sam@x.com",
    ]);
  });
});
