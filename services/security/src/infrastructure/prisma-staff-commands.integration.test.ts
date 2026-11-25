import { afterEach, describe, expect, it } from "vitest";
import type { Clock } from "@platform/contracts";
import { createTestPrismaClient } from "@platform/db/testing";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireSecurity } from "../composition";
import { HashedPasswordAuthProvider } from "./hashed-password-auth-provider";
import { PrismaPasswordCredentialStore } from "./prisma-password-credential-store";
import { ScryptPasswordHasher } from "./scrypt-password-hasher";

/**
 * Integration suite for the Wave 1d guarded staff writes on real PostgreSQL (migrations through
 * `20261126000000_staff_invitations` applied): the tenant advisory lock, the one-transaction
 * commands and the rolled-back rejections. HONESTLY GATED on `DATABASE_URL_TEST` (CI's disposable
 * Postgres job); never point it at a shared database. Clients are created lazily inside `wire`.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("Prisma staff commands (integration)", () => {
  const clock: Clock = { now: () => new Date() };
  const clients: ReturnType<typeof createTestPrismaClient>[] = [];
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.$disconnect()));
  });

  function wire(knownSubjects: readonly string[]) {
    const prisma = createTestPrismaClient(databaseUrl);
    clients.push(prisma);
    return wireSecurity({
      serializer: new InMemoryEventSerializer(),
      idGenerator: { generate: () => crypto.randomUUID() },
      clock,
      prisma,
      knownSubjects,
      passwordAuthProvider: new HashedPasswordAuthProvider({
        store: new PrismaPasswordCredentialStore(prisma),
        hasher: new ScryptPasswordHasher({ log2N: 10 }),
        clock,
      }),
    });
  }
  type Wired = ReturnType<typeof wire>;

  async function seed(
    wired: Wired,
    tenantId: string,
    externalId: string,
    email: string,
    role: string,
  ) {
    await wired.security.registerPrincipal({
      tenantId,
      externalId,
      kind: "human",
      displayName: email,
      subjectRef: externalId,
    });
    await wired.security.defineRole({ tenantId, key: role, name: role });
    await wired.security.assignRole({
      tenantId,
      principalExternalId: externalId,
      roleKey: role,
      grantedBy: "itest",
    });
    await wired.passwordRegistrar.setPassword({
      tenantId,
      identifier: `staff:${email}`,
      password: "correct horse 1",
      principalExternalId: externalId,
    });
  }
  const holdsAdmin = async (wired: Wired, tenantId: string, externalId: string) =>
    (
      (await wired.security.staffAccess({ tenantId, principalExternalId: externalId })).body as {
        roleKeys: string[];
      }
    ).roleKeys.includes("admin");

  it("two ownerless admins demoting each other in parallel: one success, one rejection, one admin remains", async () => {
    const tenantId = `staff-race-${crypto.randomUUID()}`;
    const a = `staff-${crypto.randomUUID()}`;
    const b = `staff-${crypto.randomUUID()}`;
    const wired = wire([a, b]);
    await seed(wired, tenantId, a, "a@x.com", "admin");
    await seed(wired, tenantId, b, "b@x.com", "admin");
    const demote = (actor: string, target: string) =>
      wired.security.changeStaffRole({
        tenantId,
        actorExternalId: actor,
        targetExternalId: target,
        role: "viewer",
      });
    const results = await Promise.all([demote(a, b), demote(b, a)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, expect.any(Number)]);
    const loser = results.find((r) => r.status !== 200)!;
    expect([403, 409]).toContain(loser.status);
    const admins = [await holdsAdmin(wired, tenantId, a), await holdsAdmin(wired, tenantId, b)];
    expect(admins.filter(Boolean)).toHaveLength(1);
  });

  it("two ownerless admins deactivating each other in parallel: one wins, one stays active", async () => {
    const tenantId = `staff-race-${crypto.randomUUID()}`;
    const a = `staff-${crypto.randomUUID()}`;
    const b = `staff-${crypto.randomUUID()}`;
    const wired = wire([a, b]);
    await seed(wired, tenantId, a, "a@x.com", "admin");
    await seed(wired, tenantId, b, "b@x.com", "admin");
    const off = (actor: string, target: string) =>
      wired.security.setStaffActive({
        tenantId,
        actorExternalId: actor,
        targetExternalId: target,
        active: false,
      });
    const results = await Promise.all([off(a, b), off(b, a)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const statuses = await Promise.all(
      [a, b].map(
        async (id) =>
          (
            (await wired.security.staffAccess({ tenantId, principalExternalId: id })).body as {
              status: string;
            }
          ).status,
      ),
    );
    expect(statuses.filter((s) => s === "active")).toHaveLength(1);
  });

  it("a rejected command writes nothing: the staff list is identical before and after", async () => {
    const tenantId = `staff-reject-${crypto.randomUUID()}`;
    const owner = `staff-${crypto.randomUUID()}`;
    const wired = wire([owner]);
    await seed(wired, tenantId, owner, "owner@x.com", "platform-admin");
    const list = async () =>
      JSON.stringify(
        (
          await wired.security.listStaff({
            tenantId,
            actorExternalId: owner,
            now: new Date(),
          })
        ).body,
      );
    const before = await list();
    const rejected = await wired.security.changeStaffRole({
      tenantId,
      actorExternalId: owner,
      targetExternalId: owner,
      role: "viewer",
    });
    expect(rejected.status).toBe(409);
    expect(await list()).toBe(before);
  });

  it("invite → accept is atomic: the password works only after accept; a double accept lets exactly one through", async () => {
    const tenantId = `staff-accept-${crypto.randomUUID()}`;
    const owner = `staff-${crypto.randomUUID()}`;
    const invitee = `staff-${crypto.randomUUID()}`;
    const wired = wire([owner]);
    await wired.security.registerAuthMethod({
      tenantId,
      kind: "password",
      displayName: "Password",
    });
    await seed(wired, tenantId, owner, "owner@x.com", "platform-admin");
    const tokenHash = "e".repeat(64);
    const created = await wired.security.createStaffInvitation({
      tenantId,
      actorExternalId: owner,
      principalExternalId: invitee,
      email: "sam@x.com",
      role: "operator",
      tokenHash,
      now: new Date(),
    });
    expect(created.status).toBe(201);
    const signIn = async () =>
      (
        (
          await wired.security.authenticate({
            tenantId,
            method: "password",
            identifier: "staff:sam@x.com",
            credential: "correct horse 1",
          })
        ).body as { authenticated: boolean }
      ).authenticated;
    expect(await signIn()).toBe(false);
    const accept = () =>
      wired.security.acceptStaffInvitation({
        tenantId,
        tokenHash,
        password: "correct horse 1",
        now: new Date(),
      });
    const results = await Promise.all([accept(), accept()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await signIn()).toBe(true);
  });
});
