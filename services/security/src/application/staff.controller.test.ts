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
