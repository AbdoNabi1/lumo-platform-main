import { beforeEach, describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { NativeTokenIssuer, RoleTableAccessControl } from "@platform/auth";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import {
  HashedPasswordAuthProvider,
  InMemoryPasswordCredentialStore,
  PLATFORM_ADMIN_ROLE,
  ScryptPasswordHasher,
} from "@platform/security";
import { wireAdmin, type WiredAdmin } from "./composition";
import { LiveStaffAccessControl } from "./interfaces/live-staff-access-control";

/**
 * `wireAdmin` builds ONE live staff access control: the facade `AdminGuard` of every controller decides
 * through it, `WiredAdmin.liveAccessControl` is that same instance (the HTTP guard in `server.ts` uses it),
 * and `StaffAdminController` invalidates it. No HTTP here: this is the facade half of the proof.
 */

const TENANT = "tenant-local";
const clock: Clock = { now: () => new Date("2026-11-24T10:00:00.000Z") };

class RecordingSender {
  readonly sent: { to: string; subject: string; text: string }[] = [];
  send(message: { to: string; subject: string; text: string }): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

async function setup(withStaffSender = true) {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const sender = new RecordingSender();
  const admin: WiredAdmin = wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    accessControl: new RoleTableAccessControl(),
    passwordAuthProvider: new HashedPasswordAuthProvider({
      store: new InMemoryPasswordCredentialStore(),
      hasher: new ScryptPasswordHasher({ log2N: 10 }),
      clock,
    }),
    // Native sign-in: the live staff check is on exactly when the platform issues its own staff tokens.
    staffTokenIssuer: new NativeTokenIssuer({
      privateKey: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey,
      issuer: "https://api.test/",
      audience: "morbeh-admin",
      ttlSeconds: 7200,
    }),
    ...(withStaffSender ? { staffInviteEmailSender: sender } : {}),
    adminPublicUrl: "https://admin.test",
  });
  const { security, identityDirectory, passwordRegistrar } = admin.securityWiring;
  identityDirectory.register("owner-1");
  await security.registerPrincipal({
    tenantId: TENANT,
    externalId: "owner-1",
    kind: "human",
    displayName: "owner@example.test",
    subjectRef: "owner-1",
  });
  await passwordRegistrar.setPassword({
    tenantId: TENANT,
    identifier: "staff:owner@example.test",
    password: "fake-password-1",
    principalExternalId: "owner-1",
  });
  await security.defineRole({
    tenantId: TENANT,
    key: PLATFORM_ADMIN_ROLE,
    name: PLATFORM_ADMIN_ROLE,
    permissions: ["*:*"],
  });
  await security.assignRole({
    tenantId: TENANT,
    principalExternalId: "owner-1",
    roleKey: PLATFORM_ADMIN_ROLE,
    grantedBy: "test",
  });
  const owner: Principal = { id: "owner-1", kind: "staff", roles: ["admin"], tenantId: TENANT };
  return { admin, sender, owner };
}

const tokenOf = (sender: RecordingSender) =>
  decodeURIComponent(/token=([^&\s]+)&store=/.exec(sender.sent.at(-1)?.text ?? "")?.[1] ?? "");

beforeEach(() => {
  expect.hasAssertions();
});

describe("one live access control for both guards", () => {
  it("wireAdmin exposes the instance the facade guard and StaffAdminController share", async () => {
    const { admin } = await setup();
    expect(admin.liveAccessControl).toBeInstanceOf(LiveStaffAccessControl);
  });

  it("a facade controller denies a deactivated member's existing principal at once (shared invalidate)", async () => {
    const { admin, sender, owner } = await setup();
    const invited = await admin.staff.invite(owner, TENANT, {
      email: "op@example.test",
      role: "operator",
    });
    expect(invited.status).toBe(201);
    const { principalExternalId } = invited.body as { principalExternalId: string };
    const accepted = await admin.staff.acceptInvitation({
      tenantId: TENANT,
      token: tokenOf(sender),
      password: "correct horse 1",
    });
    expect(accepted.status).toBe(200);
    const member: Principal = {
      id: principalExternalId,
      kind: "staff",
      roles: ["operator"],
      tenantId: TENANT,
    };

    expect((await admin.customers.listCustomers(member, { tenantId: TENANT })).status).toBe(200);
    expect((await admin.staff.setActive(owner, TENANT, principalExternalId, false)).status).toBe(
      200,
    );
    expect((await admin.customers.listCustomers(member, { tenantId: TENANT })).status).toBe(403);
    expect((await admin.staff.setActive(owner, TENANT, principalExternalId, true)).status).toBe(
      200,
    );
    expect((await admin.customers.listCustomers(member, { tenantId: TENANT })).status).toBe(200);
  });

  it("a role change is seen by the facade at once, and the token can never widen", async () => {
    const { admin, sender, owner } = await setup();
    const invited = await admin.staff.invite(owner, TENANT, {
      email: "vw@example.test",
      role: "viewer",
    });
    const { principalExternalId } = invited.body as { principalExternalId: string };
    await admin.staff.acceptInvitation({
      tenantId: TENANT,
      token: tokenOf(sender),
      password: "correct horse 1",
    });
    const asAdminToken: Principal = {
      id: principalExternalId,
      kind: "staff",
      roles: ["admin"],
      tenantId: TENANT,
    };
    // The token claims admin, the member is a viewer: only what both hold survives.
    expect((await admin.staff.list(asAdminToken, TENANT)).status).toBe(403);
    expect((await admin.staff.changeRole(owner, TENANT, principalExternalId, "admin")).status).toBe(
      200,
    );
    expect((await admin.staff.list(asAdminToken, TENANT)).status).toBe(200);
    expect(
      (await admin.staff.changeRole(owner, TENANT, principalExternalId, "operator")).status,
    ).toBe(200);
    expect((await admin.staff.list(asAdminToken, TENANT)).status).toBe(403);
  });

  it("owner-only: an accepted invited admin is denied security:* through the facade, the owner is not", async () => {
    const { admin, sender, owner } = await setup();
    const invited = await admin.staff.invite(owner, TENANT, {
      email: "ad@example.test",
      role: "admin",
    });
    const { principalExternalId } = invited.body as { principalExternalId: string };
    await admin.staff.acceptInvitation({
      tenantId: TENANT,
      token: tokenOf(sender),
      password: "correct horse 1",
    });
    const invitedAdmin: Principal = {
      id: principalExternalId,
      kind: "staff",
      roles: ["admin"],
      tenantId: TENANT,
    };
    expect(await admin.liveAccessControl.authorize(invitedAdmin, "security:assign_role")).toBe(
      false,
    );
    expect(await admin.liveAccessControl.authorize(invitedAdmin, "staff:invite")).toBe(true);
    expect(await admin.liveAccessControl.authorize(owner, "security:assign_role")).toBe(true);
  });

  it("with an external identity provider (no native issuer) the control is a plain pass-through", async () => {
    let n = 0;
    const admin = wireAdmin({
      serializer: new InMemoryEventSerializer(),
      idGenerator: {
        generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
      },
      clock,
      accessControl: new RoleTableAccessControl(),
    });
    const unknownToSecurity: Principal = {
      id: "ory-identity-1",
      kind: "staff",
      roles: ["admin"],
      tenantId: TENANT,
    };
    expect(await admin.liveAccessControl.authorize(unknownToSecurity, "orders:update")).toBe(true);
    // And no owner-only rule either: there are no invitations without native sign-in.
    expect(await admin.liveAccessControl.authorize(unknownToSecurity, "security:assign_role")).toBe(
      true,
    );
  });

  it("without a delivery capability invitations answer 503 and the general emailSender is not used", async () => {
    const { admin, owner } = await setup(false);
    const res = await admin.staff.invite(owner, TENANT, {
      email: "x@example.test",
      role: "viewer",
    });
    expect(res.status).toBe(503);
    expect((await admin.staff.list(owner, TENANT)).body).toMatchObject({
      items: [{ email: "owner@example.test", isOwner: true }],
    });
  });
});
