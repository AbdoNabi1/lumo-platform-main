import type { Database } from "@platform/db";
import { describe, expect, it } from "vitest";
import { buildStaffKit } from "./staff-test-kit";
import { InMemoryPasswordCredentialStore } from "./in-memory-password-credential-store";
import { PrismaPasswordCredentialStore } from "./prisma-password-credential-store";
import {
  PrismaPrincipalRepository,
  PrismaRoleAssignmentRepository,
  PrismaSessionRepository,
} from "./prisma-repositories";

/** A Prisma double whose `$transaction` hands the scoped client to the work (what runReadScoped needs). */
function scopedPrisma(models: Record<string, unknown>): Database {
  const client = { $executeRaw: async () => 0, ...models };
  return {
    $transaction: async (fn: (c: unknown) => Promise<unknown>) => fn(client),
  } as unknown as Database;
}
const unusedDeps = (prisma: Database) =>
  ({ prisma, outbox: {}, context: {} }) as unknown as ConstructorParameters<
    typeof PrismaPrincipalRepository
  >[0];

describe("PasswordCredentialStore.listByPrefix", () => {
  it("in-memory: only the prefix, only this tenant, ordered, and never a hash", async () => {
    const store = new InMemoryPasswordCredentialStore();
    const save = (tenantId: string, identifier: string, principalExternalId: string) =>
      store.save({ tenantId, identifier, principalExternalId, passwordHash: "secret-hash" });
    await save("t1", "staff:zoe@x.com", "p-zoe");
    await save("t1", "staff:amy@x.com", "p-amy");
    await save("t1", "merchant:amy@x.com", "p-m");
    await save("t2", "staff:other@x.com", "p-o");
    const listed = await store.listByPrefix("t1", "staff:");
    expect(listed).toEqual([
      { identifier: "staff:amy@x.com", principalExternalId: "p-amy" },
      { identifier: "staff:zoe@x.com", principalExternalId: "p-zoe" },
    ]);
    expect(JSON.stringify(listed)).not.toContain("secret-hash");
  });

  it("Prisma: reads inside the tenant scope, filters by tenantId and prefix, selects no hash column", async () => {
    const calls: unknown[] = [];
    const store = new PrismaPasswordCredentialStore(
      scopedPrisma({
        securityPasswordCredential: {
          findMany: async (args: unknown) => {
            calls.push(args);
            return [{ identifier: "staff:amy@x.com", principalExternalId: "p-amy" }];
          },
        },
      }),
    );
    expect(await store.listByPrefix("t1", "staff:")).toEqual([
      { identifier: "staff:amy@x.com", principalExternalId: "p-amy" },
    ]);
    expect(calls).toEqual([
      {
        where: { tenantId: "t1", identifier: { startsWith: "staff:" } },
        select: { identifier: true, principalExternalId: true },
        orderBy: { identifier: "asc" },
      },
    ]);
  });
});

describe("RoleAssignmentRepository.listActiveByTenant", () => {
  it("in-memory: active and unexpired only, this tenant only, internal principal ids", async () => {
    const kit = buildStaffKit();
    const a = await kit.seedStaff("t1", {
      externalId: "p-a",
      email: "a@x.com",
      roles: ["admin", "viewer"],
    });
    await kit.seedStaff("t2", { externalId: "p-b", email: "b@x.com", roles: ["admin"] });
    const viewer = (await kit.assignments.listByPrincipal(a, "t1")).find(
      (x) => x.roleKey === "viewer",
    )!;
    viewer.revoke("evt", kit.clock.now());
    await kit.assignments.save(viewer, "t1");
    const listed = await kit.assignments.listActiveByTenant("t1", kit.clock.now());
    expect(listed).toEqual([{ principalRef: a, roleKey: "admin" }]);
  });

  it("Prisma: where carries tenantId, status active and the expiry guard; the tx client is reused", async () => {
    const calls: unknown[] = [];
    const tx = {
      securityRoleAssignment: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return [{ principalRef: "i-1", roleKey: "admin" }];
        },
      },
    };
    const repo = new PrismaRoleAssignmentRepository(unusedDeps({} as Database));
    const now = new Date("2026-11-27T10:00:00.000Z");
    expect(await repo.listActiveByTenant("t1", now, tx)).toEqual([
      { principalRef: "i-1", roleKey: "admin" },
    ]);
    expect(calls).toEqual([
      {
        where: {
          tenantId: "t1",
          status: "active",
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { principalRef: true, roleKey: true },
      },
    ]);
  });
});

describe("SessionRepository.lastEstablishedByPrincipals", () => {
  it("in-memory: the latest establishedAt per principal, only the asked ones, only this tenant", async () => {
    const kit = buildStaffKit();
    await kit.seedSession("t1", "i-1", new Date("2026-11-01T00:00:00.000Z"));
    await kit.seedSession("t1", "i-1", new Date("2026-11-05T00:00:00.000Z"));
    await kit.seedSession("t1", "i-2", new Date("2026-11-03T00:00:00.000Z"));
    await kit.seedSession("t2", "i-1", new Date("2026-12-01T00:00:00.000Z"));
    const latest = await kit.sessions.lastEstablishedByPrincipals("t1", ["i-1", "i-3"]);
    expect([...latest.entries()]).toEqual([["i-1", new Date("2026-11-05T00:00:00.000Z")]]);
  });

  it("Prisma: groups by principal inside the tenant; an empty list never queries", async () => {
    const calls: unknown[] = [];
    const tx = {
      securitySession: {
        groupBy: async (args: unknown) => {
          calls.push(args);
          return [
            { principalRef: "i-1", _max: { establishedAt: new Date("2026-11-05T00:00:00.000Z") } },
            { principalRef: "i-2", _max: { establishedAt: null } },
          ];
        },
      },
    };
    const repo = new PrismaSessionRepository(unusedDeps({} as Database));
    expect(await repo.lastEstablishedByPrincipals("t1", [], tx)).toEqual(new Map());
    expect(calls).toEqual([]);
    const latest = await repo.lastEstablishedByPrincipals("t1", ["i-1", "i-2"], tx);
    expect([...latest.entries()]).toEqual([["i-1", new Date("2026-11-05T00:00:00.000Z")]]);
    expect(calls).toEqual([
      {
        by: ["principalRef"],
        where: { tenantId: "t1", principalRef: { in: ["i-1", "i-2"] } },
        _max: { establishedAt: true },
      },
    ]);
  });
});

describe("PrincipalReader.listSummaries", () => {
  it("in-memory: internal id, externalId, status and the registration time as createdAt", async () => {
    const kit = buildStaffKit();
    const internal = await kit.seedStaff("t1", {
      externalId: "p-a",
      email: "a@x.com",
      roles: ["admin"],
    });
    kit.clock.advance(60_000);
    await kit.seedStaff("t1", {
      externalId: "p-b",
      email: "b@x.com",
      roles: ["viewer"],
      status: "suspended",
    });
    const listed = await kit.principals.listSummaries("t1");
    expect(
      listed.map((p) => [p.id === internal, p.externalId, p.status, p.createdAt.toISOString()]),
    ).toEqual([
      [true, "p-a", "active", "2026-11-27T10:00:00.000Z"],
      [false, "p-b", "suspended", "2026-11-27T10:01:00.000Z"],
    ]);
    // saving again never moves createdAt
    kit.clock.advance(60_000);
    const again = await kit.principals.findByExternalId("p-a", "t1");
    await kit.principals.save(again!, "t1");
    expect((await kit.principals.listSummaries("t1"))[0]?.createdAt.toISOString()).toBe(
      "2026-11-27T10:00:00.000Z",
    );
  });

  it("Prisma: selects the four columns inside the tenant and maps createdAt", async () => {
    const calls: unknown[] = [];
    const createdAt = new Date("2026-11-20T00:00:00.000Z");
    const tx = {
      securityPrincipal: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return [{ id: "i-1", externalId: "p-a", status: "active", createdAt }];
        },
      },
    };
    const repo = new PrismaPrincipalRepository(unusedDeps({} as Database));
    expect(await repo.listSummaries("t1", tx)).toEqual([
      { id: "i-1", externalId: "p-a", status: "active", createdAt },
    ]);
    expect(calls).toEqual([
      {
        where: { tenantId: "t1" },
        select: { id: true, externalId: true, status: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    ]);
  });
});
