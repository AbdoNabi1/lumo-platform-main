import { afterEach, describe, expect, it } from "vitest";
import { PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { ConcurrencyError, ConflictError } from "@platform/utils";
import { INVITATION_TTL_MS, StaffInvitation } from "../domain/staff-invitation";
import { PrismaStaffInvitationRepository } from "./prisma-staff-invitation-repository";
import { PrismaStaffMutationLock } from "./prisma-staff-mutation-lock";
import { registerStaffInvitationContract } from "./staff-invitation-repository.contract";

/**
 * Integration suite for `security.staff_invitations`. Requires a real PostgreSQL with migration
 * `20261126000000_staff_invitations` applied; HONESTLY GATED on `DATABASE_URL_TEST` (CI's disposable
 * Postgres job runs it; never point it at a shared database). Client creation is lazy so gating never
 * connects.
 */
const url = process.env["DATABASE_URL_TEST"];
describe.runIf(Boolean(url))("Prisma staff invitations (integration)", () => {
  const clients: ReturnType<typeof createTestPrismaClient>[] = [];
  const tenants: string[] = [];
  afterEach(async () => {
    const client = clients[0];
    if (client)
      for (const tenantId of tenants.splice(0))
        await client.securityStaffInvitation.deleteMany({ where: { tenantId } });
    await Promise.all(clients.splice(0).map((c) => c.$disconnect()));
  });
  const wire = () => {
    const prisma = createTestPrismaClient(url);
    clients.push(prisma);
    const uow = new PrismaUnitOfWork(prisma);
    return {
      prisma,
      uow,
      repo: new PrismaStaffInvitationRepository({ prisma }),
      lock: new PrismaStaffMutationLock(),
      run: <T>(work: (tx: unknown) => Promise<T>) => uow.run((tx) => work(tx)),
      tenant: () => {
        const id = `staff-invitations-${crypto.randomUUID()}`;
        tenants.push(id);
        return id;
      },
    };
  };
  const token = (): string => crypto.randomUUID().replaceAll("-", "").padEnd(64, "0");

  registerStaffInvitationContract(() => wire());

  it("writes without the unit of work's tx throw", async () => {
    const { repo, tenant } = wire();
    const inv = StaffInvitation.create(
      UniqueEntityId.from(crypto.randomUUID()),
      {
        tenantId: tenant(),
        email: "sam@example.com",
        principalExternalId: "p",
        roleKey: "viewer",
        invitedBy: "o",
        tokenHash: token(),
      },
      new Date(),
      INVITATION_TTL_MS,
    );
    await expect(repo.save(inv)).rejects.toThrow(/requires the unit of work's transaction client/);
  });

  it("the advisory lock serializes concurrent critical sections of one tenant", async () => {
    const { uow, lock, tenant } = wire();
    const tenantId = tenant();
    const order: string[] = [];
    const section = (name: string) =>
      uow.run((tx) =>
        lock.withTenantStaffLock(tenantId, tx, async () => {
          order.push(`${name}:start`);
          await new Promise((r) => setTimeout(r, 50));
          order.push(`${name}:end`);
        }),
      );
    await Promise.all([section("a"), section("b")]);
    expect(order[0]!.endsWith(":start")).toBe(true);
    expect(order[1]).toBe(order[0]!.replace(":start", ":end"));
  });

  it("the partial unique index is enforced by the database, and CAS stays exact", async () => {
    const { repo, run, tenant } = wire();
    const tenantId = tenant();
    const make = (email: string) =>
      StaffInvitation.create(
        UniqueEntityId.from(crypto.randomUUID()),
        {
          tenantId,
          email,
          principalExternalId: "p",
          roleKey: "admin",
          invitedBy: "o",
          tokenHash: token(),
        },
        new Date(),
        INVITATION_TTL_MS,
      );
    const a = make("x@example.com");
    await run((tx) => repo.save(a, tx));
    await expect(run((tx) => repo.save(make("x@example.com"), tx))).rejects.toBeInstanceOf(
      ConflictError,
    );
    const stale = (await repo.findById(tenantId, a.id.toString()))!;
    const fresh = (await repo.findById(tenantId, a.id.toString()))!;
    fresh.revoke(new Date());
    await run((tx) => repo.save(fresh, tx));
    stale.revoke(new Date());
    await expect(run((tx) => repo.save(stale, tx))).rejects.toBeInstanceOf(ConcurrencyError);
  });
});
