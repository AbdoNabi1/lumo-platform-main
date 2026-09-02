import { afterEach, describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import { Membership } from "../domain/membership";
import { Organization } from "../domain/organization";
import { User } from "../domain/user";
import { Email } from "../domain/value-objects/email";
import { OrganizationSlug } from "../domain/value-objects/organization-slug";
import { RoleName } from "../domain/value-objects/role-name";
import { IdentityEventTranslator } from "./identity-event-translator";
import {
  PrismaMembershipRepository,
  PrismaOrganizationRepository,
  PrismaUserRepository,
} from "./prisma-access-repositories";

/**
 * Integration suite for Identity's Prisma access repositories — `User`/`Organization`/
 * `Membership` (Sprint 4.1, Option A). Requires a real PostgreSQL with the
 * `20260712000000_identity_access_sprint41` migration applied:
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/identity test
 *
 * HONESTLY GATED: without `DATABASE_URL_TEST` the suite is skipped — never faked. Client creation
 * is lazy (inside `wire`, called within each `it`) so gating never connects. Every test scopes its
 * data to a fresh `tenant-itest-<uuid>` (and/or random emails/slugs) so runs never collide with
 * each other or with historical rows left by other suites.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

function must<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok || result.value === undefined) throw new Error("test setup: invalid VO");
  return result.value;
}

describe.runIf(Boolean(databaseUrl))("Prisma Identity access repositories (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-15T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };
  const openClients: ReturnType<typeof createTestPrismaClient>[] = [];
  const usedTenantIds: string[] = [];

  afterEach(async () => {
    // Clean up exactly what THIS suite created — scoped strictly to the random tenant ids each
    // test generated — never a blanket delete that could touch another suite's or historical rows
    // (the shared `identity` tables have no other writer using this `tenant-itest-<uuid>` prefix).
    const client = openClients[0];
    if (client !== undefined && usedTenantIds.length > 0) {
      const tenantId = { in: usedTenantIds.splice(0) };
      await client.membership.deleteMany({ where: { tenantId } });
      await client.organization.deleteMany({ where: { tenantId } });
      await client.user.deleteMany({ where: { tenantId } });
    }
    // The outbox context tenantId is a fixed "tenant-itest" literal for this whole file (matching
    // the reference `PrismaOrderRepository` suite's convention), so outbox rows can't be cleaned
    // up by the per-test tenant id above — clean up by `producer` instead. Only THIS suite ever
    // writes `producer: "identity"` rows into the shared `platform.outbox` table, so this can't
    // touch another bounded context's (or another test file's) rows.
    if (client !== undefined) {
      await client.outboxEntry.deleteMany({ where: { producer: "identity" } });
    }
    await Promise.all(openClients.splice(0).map((c) => c.$disconnect()));
  });

  function wire() {
    const prisma = createTestPrismaClient(databaseUrl);
    openClients.push(prisma);
    const outboxStore = new PrismaOutboxStore(prisma);
    const outbox = new OutboxWriter({
      store: outboxStore,
      translator: new IdentityEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "identity",
    });
    const context = rootEventContext(ids, "tenant-itest");
    const deps = { prisma, outbox, context };
    return {
      prisma,
      users: new PrismaUserRepository(deps),
      organizations: new PrismaOrganizationRepository(deps),
      memberships: new PrismaMembershipRepository(deps),
      unitOfWork: new PrismaUnitOfWork(prisma),
      outboxStore,
    };
  }

  function tenant(): string {
    const id = `tenant-itest-${crypto.randomUUID()}`;
    usedTenantIds.push(id);
    return id;
  }

  function email(local = crypto.randomUUID()): Email {
    return must(Email.create(`${local}@itest.example.com`));
  }

  function slug(prefix = "org"): OrganizationSlug {
    return must(OrganizationSlug.create(`${prefix}-${crypto.randomUUID()}`));
  }

  function role(value = "member"): RoleName {
    return must(RoleName.create(value));
  }

  // ---------------------------------------------------------------------------------------------
  // User
  // ---------------------------------------------------------------------------------------------
  describe("PrismaUserRepository", () => {
    it("round-trips a created user: tenant, email, name, status, version", async () => {
      const { users, unitOfWork } = wire();
      const t = tenant();
      const em = email();
      const id = UniqueEntityId.from(ids.generate());
      const user = User.create(id, t, em, "Alice", ids.generate(), clock.now());

      await unitOfWork.run((tx) => users.save(user, tx));
      const loaded = await users.findById(id.toString(), t);

      expect(loaded).not.toBeNull();
      expect(loaded?.tenantId).toBe(t);
      expect(loaded?.email.value).toBe(em.value);
      expect(loaded?.name).toBe("Alice");
      expect(loaded?.status).toBe("active");
      expect(loaded?.version).toBe(1);
    });

    it("returns null for a nonexistent user id", async () => {
      const { users } = wire();
      const loaded = await users.findById(crypto.randomUUID(), tenant());
      expect(loaded).toBeNull();
    });

    it("rejects a duplicate email within the same tenant (unique tenant_id+email)", async () => {
      const { users, unitOfWork } = wire();
      const t = tenant();
      const em = email();
      const first = User.create(
        UniqueEntityId.from(ids.generate()),
        t,
        em,
        "Alice",
        ids.generate(),
        clock.now(),
      );
      const second = User.create(
        UniqueEntityId.from(ids.generate()),
        t,
        em,
        "Alice Clone",
        ids.generate(),
        clock.now(),
      );
      await unitOfWork.run((tx) => users.save(first, tx));
      await expect(unitOfWork.run((tx) => users.save(second, tx))).rejects.toThrow();
    });

    it("allows the SAME email across two different tenants (uniqueness is per-tenant)", async () => {
      const { users, unitOfWork } = wire();
      const em = email();
      const tenantA = tenant();
      const tenantB = tenant();
      const userA = User.create(
        UniqueEntityId.from(ids.generate()),
        tenantA,
        em,
        "Alice A",
        ids.generate(),
        clock.now(),
      );
      const userB = User.create(
        UniqueEntityId.from(ids.generate()),
        tenantB,
        em,
        "Alice B",
        ids.generate(),
        clock.now(),
      );
      await unitOfWork.run((tx) => users.save(userA, tx));
      await unitOfWork.run((tx) => users.save(userB, tx));

      const foundA = await users.findByEmail(em.value, tenantA);
      const foundB = await users.findByEmail(em.value, tenantB);
      expect(foundA?.name).toBe("Alice A");
      expect(foundB?.name).toBe("Alice B");
    });

    it("does not leak a user across tenants: findByEmail/findById scoped strictly by tenantId", async () => {
      const { users, unitOfWork } = wire();
      const tenantA = tenant();
      const tenantB = tenant();
      const em = email();
      const id = UniqueEntityId.from(ids.generate());
      const user = User.create(id, tenantA, em, "Alice", ids.generate(), clock.now());
      await unitOfWork.run((tx) => users.save(user, tx));

      expect(await users.findById(id.toString(), tenantB)).toBeNull();
      expect(await users.findByEmail(em.value, tenantB)).toBeNull();
    });

    it("rename persists the new name and increments version", async () => {
      const { users, unitOfWork } = wire();
      const t = tenant();
      const id = UniqueEntityId.from(ids.generate());
      const user = User.create(id, t, email(), "Alice", ids.generate(), clock.now());
      await unitOfWork.run((tx) => users.save(user, tx));

      const loaded = await users.findById(id.toString(), t);
      if (loaded === null) throw new Error("setup failed");
      loaded.rename("Alicia", ids.generate(), clock.now());
      await unitOfWork.run((tx) => users.save(loaded, tx));

      const reloaded = await users.findById(id.toString(), t);
      expect(reloaded?.name).toBe("Alicia");
      expect(reloaded?.version).toBe(2);
    });

    it("deactivate persists status=deactivated and leaves memberships untouched (access revocation is out-of-band)", async () => {
      const { users, organizations, memberships, unitOfWork } = wire();
      const t = tenant();
      const userId = UniqueEntityId.from(ids.generate());
      const user = User.create(userId, t, email(), "Alice", ids.generate(), clock.now());
      const orgId = UniqueEntityId.from(ids.generate());
      const organization = Organization.create(
        orgId,
        t,
        slug(),
        "Acme",
        ids.generate(),
        clock.now(),
      );
      const membership = Membership.create(
        UniqueEntityId.from(ids.generate()),
        t,
        userId.toString(),
        orgId.toString(),
        role("admin"),
        ids.generate(),
        clock.now(),
      );
      await unitOfWork.run((tx) => users.save(user, tx));
      await unitOfWork.run((tx) => organizations.save(organization, tx));
      await unitOfWork.run((tx) => memberships.save(membership, tx));

      const loadedUser = await users.findById(userId.toString(), t);
      if (loadedUser === null) throw new Error("setup failed");
      loadedUser.deactivate(ids.generate(), clock.now());
      await unitOfWork.run((tx) => users.save(loadedUser, tx));

      const reloadedUser = await users.findById(userId.toString(), t);
      expect(reloadedUser?.status).toBe("deactivated");
      expect(reloadedUser?.isActive).toBe(false);

      // Documents actual (D-002) behavior: deactivating a user does NOT cascade to memberships —
      // the role grant physically remains in the database. Enforcing "deactivated users can't act"
      // is Keto's/the caller's responsibility, not this repository's. This is a coverage note, not
      // a defect: no FK/cascade exists between User and Membership by design.
      const stillGranted = await memberships.findByUserAndOrganization(
        userId.toString(),
        orgId.toString(),
        t,
      );
      expect(stillGranted).not.toBeNull();
      expect(stillGranted?.roleName.value).toBe("admin");
    });

    it("rejects a stale write with ConcurrencyError — no lost update", async () => {
      const { users, unitOfWork } = wire();
      const t = tenant();
      const id = UniqueEntityId.from(ids.generate());
      const user = User.create(id, t, email(), "Alice", ids.generate(), clock.now());
      await unitOfWork.run((tx) => users.save(user, tx));

      const first = await users.findById(id.toString(), t);
      const second = await users.findById(id.toString(), t);
      if (first === null || second === null) throw new Error("setup failed");
      first.rename("First Writer", ids.generate(), clock.now());
      second.rename("Second Writer", ids.generate(), clock.now());

      await unitOfWork.run((tx) => users.save(first, tx));
      await expect(unitOfWork.run((tx) => users.save(second, tx))).rejects.toBeInstanceOf(
        ConcurrencyError,
      );

      const reloaded = await users.findById(id.toString(), t);
      expect(reloaded?.name).toBe("First Writer");
      expect(reloaded?.version).toBe(2);
    });

    it("does not persist a partial write when the transaction fails after save()", async () => {
      const { users, unitOfWork } = wire();
      const t = tenant();
      const id = UniqueEntityId.from(ids.generate());
      const user = User.create(id, t, email(), "Alice", ids.generate(), clock.now());

      await expect(
        unitOfWork.run(async (tx) => {
          await users.save(user, tx);
          throw new Error("simulated failure after write");
        }),
      ).rejects.toThrow("simulated failure");

      const loaded = await users.findById(id.toString(), t);
      expect(loaded).toBeNull();
    });

    it("writes the outbox row (user.created) in the SAME transaction as the aggregate", async () => {
      const { users, unitOfWork, prisma } = wire();
      const t = tenant();
      const id = UniqueEntityId.from(ids.generate());
      const user = User.create(id, t, email(), "Alice", ids.generate(), clock.now());

      await unitOfWork.run((tx) => users.save(user, tx));
      // Scoped by key rather than `outboxStore.fetchPending(N)`'s global oldest-first window, which
      // the shared `platform.outbox` table's concurrent writers from every other bounded context's
      // integration suite can push this row outside of under a full-monorepo parallel test run.
      const rows = await prisma.outboxEntry.findMany({ where: { key: id.toString() } });
      expect(rows.some((e) => e.topic.includes("user"))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Organization
  // ---------------------------------------------------------------------------------------------
  describe("PrismaOrganizationRepository", () => {
    it("round-trips a created organization", async () => {
      const { organizations, unitOfWork } = wire();
      const t = tenant();
      const s = slug();
      const id = UniqueEntityId.from(ids.generate());
      const organization = Organization.create(id, t, s, "Acme", ids.generate(), clock.now());

      await unitOfWork.run((tx) => organizations.save(organization, tx));
      const loaded = await organizations.findById(id.toString(), t);

      expect(loaded?.slug.value).toBe(s.value);
      expect(loaded?.name).toBe("Acme");
      expect(loaded?.status).toBe("active");
      expect(loaded?.version).toBe(1);
    });

    it("returns null for a nonexistent organization id", async () => {
      const { organizations } = wire();
      expect(await organizations.findById(crypto.randomUUID(), tenant())).toBeNull();
    });

    it("rejects a duplicate slug within the same tenant", async () => {
      const { organizations, unitOfWork } = wire();
      const t = tenant();
      const s = slug();
      const first = Organization.create(
        UniqueEntityId.from(ids.generate()),
        t,
        s,
        "Acme",
        ids.generate(),
        clock.now(),
      );
      const second = Organization.create(
        UniqueEntityId.from(ids.generate()),
        t,
        s,
        "Acme Clone",
        ids.generate(),
        clock.now(),
      );
      await unitOfWork.run((tx) => organizations.save(first, tx));
      await expect(unitOfWork.run((tx) => organizations.save(second, tx))).rejects.toThrow();
    });

    it("allows the SAME slug across two different tenants", async () => {
      const { organizations, unitOfWork } = wire();
      const s = slug();
      const tenantA = tenant();
      const tenantB = tenant();
      await unitOfWork.run((tx) =>
        organizations.save(
          Organization.create(
            UniqueEntityId.from(ids.generate()),
            tenantA,
            s,
            "Acme A",
            ids.generate(),
            clock.now(),
          ),
          tx,
        ),
      );
      await unitOfWork.run((tx) =>
        organizations.save(
          Organization.create(
            UniqueEntityId.from(ids.generate()),
            tenantB,
            s,
            "Acme B",
            ids.generate(),
            clock.now(),
          ),
          tx,
        ),
      );

      expect((await organizations.findBySlug(s.value, tenantA))?.name).toBe("Acme A");
      expect((await organizations.findBySlug(s.value, tenantB))?.name).toBe("Acme B");
    });

    it("archive persists status=archived and increments version", async () => {
      const { organizations, unitOfWork } = wire();
      const t = tenant();
      const id = UniqueEntityId.from(ids.generate());
      const organization = Organization.create(id, t, slug(), "Acme", ids.generate(), clock.now());
      await unitOfWork.run((tx) => organizations.save(organization, tx));

      const loaded = await organizations.findById(id.toString(), t);
      if (loaded === null) throw new Error("setup failed");
      loaded.archive();
      await unitOfWork.run((tx) => organizations.save(loaded, tx));

      const reloaded = await organizations.findById(id.toString(), t);
      expect(reloaded?.status).toBe("archived");
      expect(reloaded?.version).toBe(2);
    });

    it("rejects a stale write with ConcurrencyError", async () => {
      const { organizations, unitOfWork } = wire();
      const t = tenant();
      const id = UniqueEntityId.from(ids.generate());
      const organization = Organization.create(id, t, slug(), "Acme", ids.generate(), clock.now());
      await unitOfWork.run((tx) => organizations.save(organization, tx));

      const first = await organizations.findById(id.toString(), t);
      const second = await organizations.findById(id.toString(), t);
      if (first === null || second === null) throw new Error("setup failed");
      first.archive();
      await unitOfWork.run((tx) => organizations.save(first, tx));

      // `second` is a distinct in-memory instance still carrying the pre-archive version/status.
      await expect(unitOfWork.run((tx) => organizations.save(second, tx))).rejects.toBeInstanceOf(
        ConcurrencyError,
      );
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Membership
  // ---------------------------------------------------------------------------------------------
  describe("PrismaMembershipRepository", () => {
    it("round-trips a created membership", async () => {
      const { memberships, unitOfWork } = wire();
      const t = tenant();
      const userId = crypto.randomUUID();
      const orgId = crypto.randomUUID();
      const id = UniqueEntityId.from(ids.generate());
      const membership = Membership.create(
        id,
        t,
        userId,
        orgId,
        role("admin"),
        ids.generate(),
        clock.now(),
      );

      await unitOfWork.run((tx) => memberships.save(membership, tx));
      const loaded = await memberships.findById(id.toString(), t);

      expect(loaded?.userId).toBe(userId);
      expect(loaded?.organizationId).toBe(orgId);
      expect(loaded?.roleName.value).toBe("admin");
      expect(loaded?.version).toBe(1);
    });

    it("returns null for a nonexistent membership id", async () => {
      const { memberships } = wire();
      expect(await memberships.findById(crypto.randomUUID(), tenant())).toBeNull();
    });

    it(
      "allows a membership referencing a nonexistent user/organization id " +
        "(D-002: bare reference, no FK by design — not a bug)",
      async () => {
        const { memberships, unitOfWork } = wire();
        const t = tenant();
        const membership = Membership.create(
          UniqueEntityId.from(ids.generate()),
          t,
          crypto.randomUUID(), // no User row with this id exists
          crypto.randomUUID(), // no Organization row with this id exists
          role("member"),
          ids.generate(),
          clock.now(),
        );
        await expect(
          unitOfWork.run((tx) => memberships.save(membership, tx)),
        ).resolves.not.toThrow();
      },
    );

    it("rejects a duplicate (tenant, user, organization) membership", async () => {
      const { memberships, unitOfWork } = wire();
      const t = tenant();
      const userId = crypto.randomUUID();
      const orgId = crypto.randomUUID();
      const first = Membership.create(
        UniqueEntityId.from(ids.generate()),
        t,
        userId,
        orgId,
        role("member"),
        ids.generate(),
        clock.now(),
      );
      const second = Membership.create(
        UniqueEntityId.from(ids.generate()),
        t,
        userId,
        orgId,
        role("admin"),
        ids.generate(),
        clock.now(),
      );
      await unitOfWork.run((tx) => memberships.save(first, tx));
      await expect(unitOfWork.run((tx) => memberships.save(second, tx))).rejects.toThrow();
    });

    it("does not leak a membership across tenants even when user/org ids collide", async () => {
      const { memberships, unitOfWork } = wire();
      const tenantA = tenant();
      const tenantB = tenant();
      const userId = crypto.randomUUID();
      const orgId = crypto.randomUUID();
      const membership = Membership.create(
        UniqueEntityId.from(ids.generate()),
        tenantA,
        userId,
        orgId,
        role("admin"),
        ids.generate(),
        clock.now(),
      );
      await unitOfWork.run((tx) => memberships.save(membership, tx));

      expect(await memberships.findByUserAndOrganization(userId, orgId, tenantB)).toBeNull();
      expect(
        (await memberships.findByUserAndOrganization(userId, orgId, tenantA))?.roleName.value,
      ).toBe("admin");
    });

    it("changeRole persists the new role and the old role no longer grants anything (single-column overwrite)", async () => {
      const { memberships, unitOfWork } = wire();
      const t = tenant();
      const userId = crypto.randomUUID();
      const orgId = crypto.randomUUID();
      const id = UniqueEntityId.from(ids.generate());
      const membership = Membership.create(
        id,
        t,
        userId,
        orgId,
        role("org_admin"),
        ids.generate(),
        clock.now(),
      );
      await unitOfWork.run((tx) => memberships.save(membership, tx));

      const loaded = await memberships.findById(id.toString(), t);
      if (loaded === null) throw new Error("setup failed");
      loaded.changeRole(role("member"), ids.generate(), clock.now());
      await unitOfWork.run((tx) => memberships.save(loaded, tx));

      const reloaded = await memberships.findById(id.toString(), t);
      expect(reloaded?.roleName.value).toBe("member");
      expect(reloaded?.version).toBe(2);
    });

    it("rejects a stale role-change write with ConcurrencyError — no silent privilege overwrite", async () => {
      const { memberships, unitOfWork } = wire();
      const t = tenant();
      const userId = crypto.randomUUID();
      const orgId = crypto.randomUUID();
      const id = UniqueEntityId.from(ids.generate());
      const membership = Membership.create(
        id,
        t,
        userId,
        orgId,
        role("member"),
        ids.generate(),
        clock.now(),
      );
      await unitOfWork.run((tx) => memberships.save(membership, tx));

      const first = await memberships.findById(id.toString(), t);
      const second = await memberships.findById(id.toString(), t);
      if (first === null || second === null) throw new Error("setup failed");
      first.changeRole(role("org_admin"), ids.generate(), clock.now());
      second.changeRole(role("owner"), ids.generate(), clock.now());

      await unitOfWork.run((tx) => memberships.save(first, tx));
      await expect(unitOfWork.run((tx) => memberships.save(second, tx))).rejects.toBeInstanceOf(
        ConcurrencyError,
      );

      // The winning writer's role is what's actually granted — not silently clobbered by the loser.
      const reloaded = await memberships.findById(id.toString(), t);
      expect(reloaded?.roleName.value).toBe("org_admin");
    });

    it("concurrent role changes to DIFFERENT members of the same organization do not cross-contaminate", async () => {
      const { memberships, unitOfWork } = wire();
      const t = tenant();
      const orgId = crypto.randomUUID();
      const memberA = Membership.create(
        UniqueEntityId.from(ids.generate()),
        t,
        crypto.randomUUID(),
        orgId,
        role("member"),
        ids.generate(),
        clock.now(),
      );
      const memberB = Membership.create(
        UniqueEntityId.from(ids.generate()),
        t,
        crypto.randomUUID(),
        orgId,
        role("member"),
        ids.generate(),
        clock.now(),
      );
      await unitOfWork.run((tx) => memberships.save(memberA, tx));
      await unitOfWork.run((tx) => memberships.save(memberB, tx));

      const loadedA = await memberships.findById(memberA.id.toString(), t);
      const loadedB = await memberships.findById(memberB.id.toString(), t);
      if (loadedA === null || loadedB === null) throw new Error("setup failed");
      loadedA.changeRole(role("org_admin"), ids.generate(), clock.now());
      loadedB.changeRole(role("billing_admin"), ids.generate(), clock.now());

      await Promise.all([
        unitOfWork.run((tx) => memberships.save(loadedA, tx)),
        unitOfWork.run((tx) => memberships.save(loadedB, tx)),
      ]);

      const reloadedA = await memberships.findById(memberA.id.toString(), t);
      const reloadedB = await memberships.findById(memberB.id.toString(), t);
      expect(reloadedA?.roleName.value).toBe("org_admin");
      expect(reloadedB?.roleName.value).toBe("billing_admin");
    });

    it("writes the outbox row (membership.role_changed) in the SAME transaction", async () => {
      const { memberships, unitOfWork, prisma } = wire();
      const t = tenant();
      const id = UniqueEntityId.from(ids.generate());
      const membership = Membership.create(
        id,
        t,
        crypto.randomUUID(),
        crypto.randomUUID(),
        role("member"),
        ids.generate(),
        clock.now(),
      );
      await unitOfWork.run((tx) => memberships.save(membership, tx));

      const loaded = await memberships.findById(id.toString(), t);
      if (loaded === null) throw new Error("setup failed");
      loaded.changeRole(role("org_admin"), ids.generate(), clock.now());
      await unitOfWork.run((tx) => memberships.save(loaded, tx));

      // Scoped by key — see note in the "user.created" outbox test above.
      const rows = await prisma.outboxEntry.findMany({ where: { key: id.toString() } });
      expect(rows.some((e) => e.topic.includes("role_changed"))).toBe(true);
    });
  });
});
