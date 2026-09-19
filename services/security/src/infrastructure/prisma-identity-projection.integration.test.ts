import { describe, expect, it } from "vitest";
import type { IdGenerator } from "@platform/contracts";
import { createTestPrismaClient } from "@platform/db/testing";
import { PrismaIdentityProjectionStore } from "./prisma-identity-projection";

/**
 * Integration suite for the Identity projection Prisma store (H-2, G-SEC-4). Requires a real PostgreSQL
 * with the `20260718110000_security_identity_projection` migration applied:
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/security test
 *
 * HONESTLY GATED: skipped without `DATABASE_URL_TEST` — never faked. CI provisions Postgres + runs
 * `prisma migrate deploy` first (the existing `db-integration` workflow runs the security suite).
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("PrismaIdentityProjectionStore (integration)", () => {
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };
  const tenantId = "tenant-identity-itest";

  function store() {
    const prisma = createTestPrismaClient(databaseUrl);
    return new PrismaIdentityProjectionStore({ prisma, idGenerator: ids });
  }

  it("projects users/orgs/memberships, transitions status, updates role, and enforces LWW", async () => {
    const s = store();
    const user = `u-${crypto.randomUUID()}`;
    const org = `o-${crypto.randomUUID()}`;
    const mem = `m-${crypto.randomUUID()}`;

    await s.upsertUser(
      {
        userId: user,
        userTenant: "t1",
        status: "active",
        occurredAt: "2026-07-18T00:00:00.000Z",
      },
      tenantId,
    );
    expect((await s.getUser(user, tenantId))?.status).toBe("active");

    await s.setUserStatus(user, "deactivated", "2026-07-18T01:00:00.000Z", tenantId);
    const u = await s.getUser(user, tenantId);
    expect(u?.status).toBe("deactivated");
    expect(u?.userTenant).toBe("t1"); // preserved

    // Older redelivery ignored.
    await s.setUserStatus(user, "active", "2026-07-18T00:30:00.000Z", tenantId);
    expect((await s.getUser(user, tenantId))?.status).toBe("deactivated");

    await s.upsertOrganization(
      {
        organizationId: org,
        slug: "acme",
        orgTenant: "t1",
        occurredAt: "2026-07-18T00:00:00.000Z",
      },
      tenantId,
    );
    await s.upsertMembership(
      {
        membershipId: mem,
        userId: user,
        organizationId: org,
        role: "member",
        occurredAt: "2026-07-18T00:10:00.000Z",
      },
      tenantId,
    );
    await s.setMembershipRole(mem, "admin", "2026-07-18T00:20:00.000Z", tenantId);

    const memberships = await s.listMembershipsByUser(user, tenantId);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe("admin");
    expect((await s.getOrganization(org, tenantId))?.slug).toBe("acme");
  });
});
