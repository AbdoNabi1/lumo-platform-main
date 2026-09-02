import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireIdentity } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-12T00:00:00.000Z") };

function wire() {
  return wireIdentity({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

async function newUserId(
  app: ReturnType<typeof wire>,
  email = "alice@example.com",
): Promise<string> {
  const created = await app.access.createUser({ tenantId: "tenant-1", email, name: "Alice" });
  expect(created.status).toBe(201);
  return (created.body as { userId: string }).userId;
}

async function newOrganizationId(app: ReturnType<typeof wire>, slug = "acme"): Promise<string> {
  const created = await app.access.createOrganization({ tenantId: "tenant-1", slug, name: "Acme" });
  expect(created.status).toBe(201);
  return (created.body as { organizationId: string }).organizationId;
}

describe("access flow (end to end)", () => {
  it("creates a user, renames it, and deactivates it, publishing the events", async () => {
    const app = wire();
    const userId = await newUserId(app);

    const renamed = await app.access.renameUser({ tenantId: "tenant-1", userId, name: "Alicia" });
    expect(renamed.status).toBe(200);
    expect((renamed.body as { name: string }).name).toBe("Alicia");

    const deactivated = await app.access.deactivateUser({ tenantId: "tenant-1", userId });
    expect(deactivated.status).toBe(200);

    expect(await app.drainOutbox()).toBe(3); // created + updated + deactivated
    expect(app.deliveredEventTypes).toEqual([
      "identity.user.created",
      "identity.user.updated",
      "identity.user.deactivated",
    ]);
  });

  it("rejects a duplicate email within the same tenant (409)", async () => {
    const app = wire();
    await newUserId(app, "dupe@example.com");
    const response = await app.access.createUser({
      tenantId: "tenant-1",
      email: "dupe@example.com",
      name: "Bob",
    });
    expect(response.status).toBe(409);
  });

  it("allows the same email across different tenants", async () => {
    const app = wire();
    await app.access.createUser({
      tenantId: "tenant-1",
      email: "shared@example.com",
      name: "Alice",
    });
    const response = await app.access.createUser({
      tenantId: "tenant-2",
      email: "shared@example.com",
      name: "Alice",
    });
    expect(response.status).toBe(201);
  });

  it("creates an organization and archives it", async () => {
    const app = wire();
    const organizationId = await newOrganizationId(app);

    const archived = await app.access.archiveOrganization({ tenantId: "tenant-1", organizationId });
    expect(archived.status).toBe(200);
    expect(await app.drainOutbox()).toBe(1); // created only — archive has no dedicated event
    expect(app.deliveredEventTypes).toEqual(["identity.organization.created"]);
  });

  it("rejects a duplicate slug within the same tenant (409)", async () => {
    const app = wire();
    await newOrganizationId(app, "dupe-org");
    const response = await app.access.createOrganization({
      tenantId: "tenant-1",
      slug: "dupe-org",
      name: "Dupe",
    });
    expect(response.status).toBe(409);
  });

  it("adds a membership and changes its role", async () => {
    const app = wire();
    const userId = await newUserId(app);
    const organizationId = await newOrganizationId(app);

    const added = await app.access.addMembership({
      tenantId: "tenant-1",
      userId,
      organizationId,
      roleName: "admin",
    });
    expect(added.status).toBe(201);
    const membershipId = (added.body as { membershipId: string }).membershipId;

    const changed = await app.access.changeMembershipRole({
      tenantId: "tenant-1",
      membershipId,
      roleName: "viewer",
    });
    expect(changed.status).toBe(200);
    expect((changed.body as { roleName: string }).roleName).toBe("viewer");

    expect(await app.drainOutbox()).toBe(4); // user.created + org.created + membership.created + role_changed
    expect(app.deliveredEventTypes).toEqual([
      "identity.user.created",
      "identity.organization.created",
      "identity.membership.created",
      "identity.membership.role_changed",
    ]);
  });

  it("rejects adding a duplicate membership for the same user/organization pair (409)", async () => {
    const app = wire();
    const userId = await newUserId(app);
    const organizationId = await newOrganizationId(app);
    await app.access.addMembership({
      tenantId: "tenant-1",
      userId,
      organizationId,
      roleName: "admin",
    });

    const response = await app.access.addMembership({
      tenantId: "tenant-1",
      userId,
      organizationId,
      roleName: "viewer",
    });
    expect(response.status).toBe(409);
  });

  it("returns 404 changing the role of an unknown membership", async () => {
    const app = wire();
    const response = await app.access.changeMembershipRole({
      tenantId: "tenant-1",
      membershipId: "missing",
      roleName: "admin",
    });
    expect(response.status).toBe(404);
  });

  it("rejects an invalid role name (422)", async () => {
    const app = wire();
    const userId = await newUserId(app);
    const organizationId = await newOrganizationId(app);
    const response = await app.access.addMembership({
      tenantId: "tenant-1",
      userId,
      organizationId,
      roleName: "Not A Valid Role!",
    });
    expect(response.status).toBe(422);
  });

  it("keeps the Customer vertical unaffected (still wired, still functional)", async () => {
    const app = wire();
    const registered = await app.customers.register({
      email: "customer@example.com",
      name: "Carol",
    });
    expect(registered.status).toBe(201);
  });
});
