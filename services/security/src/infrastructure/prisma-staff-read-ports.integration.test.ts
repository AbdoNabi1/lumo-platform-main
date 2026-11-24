import { afterEach, describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork, type TransactionClient } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { Principal } from "../domain/principal";
import { RoleAssignment } from "../domain/role-assignment";
import { Session } from "../domain/session";
import { PrismaPasswordCredentialStore } from "./prisma-password-credential-store";
import {
  PrismaPrincipalRepository,
  PrismaRoleAssignmentRepository,
  PrismaSessionRepository,
} from "./prisma-repositories";
import { SecurityEventTranslator } from "./security-event-translator";

/**
 * Integration suite for the Wave 1d staff read ports against a real PostgreSQL (migrations through
 * `20261126000000_staff_invitations` applied). HONESTLY GATED on `DATABASE_URL_TEST` (CI's disposable
 * Postgres job); never point it at a shared database. Clients are created lazily inside `wire`.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("Prisma staff read ports (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-11-27T10:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };
  const clients: ReturnType<typeof createTestPrismaClient>[] = [];
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.$disconnect()));
  });

  function wire() {
    const prisma = createTestPrismaClient(databaseUrl);
    clients.push(prisma);
    const outbox = new OutboxWriter<TransactionClient>({
      store: new PrismaOutboxStore(prisma),
      translator: new SecurityEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "security",
    });
    const deps = { prisma, outbox, context: rootEventContext(ids) };
    return {
      uow: new PrismaUnitOfWork(prisma),
      principals: new PrismaPrincipalRepository(deps),
      assignments: new PrismaRoleAssignmentRepository(deps),
      sessions: new PrismaSessionRepository(deps),
      credentials: new PrismaPasswordCredentialStore(prisma),
    };
  }

  it("principal summaries, active assignments, last sign-in and staff credentials, tenant-scoped", async () => {
    const { uow, principals, assignments, sessions, credentials } = wire();
    const tenantId = `staff-read-${ids.generate()}`;
    const otherTenant = `staff-read-${ids.generate()}`;
    const externalId = `staff-${ids.generate()}`;
    const principal = Principal.register(
      UniqueEntityId.from(ids.generate()),
      {
        externalId,
        kind: "human",
        displayName: "a@x.com",
        subjectRef: externalId,
        tenantRef: tenantId,
      },
      ids.generate(),
      clock.now(),
    );
    const internalId = principal.id.toString();
    await uow.run(async (tx) => {
      await principals.save(principal, tenantId, tx);
      await assignments.save(
        RoleAssignment.grant(
          UniqueEntityId.from(ids.generate()),
          { principalRef: internalId, roleKey: "admin", grantedBy: "seed" },
          ids.generate(),
          clock.now(),
        ),
        tenantId,
        tx,
      );
      await assignments.save(
        RoleAssignment.grant(
          UniqueEntityId.from(ids.generate()),
          {
            principalRef: internalId,
            roleKey: "viewer",
            grantedBy: "seed",
            expiresAt: new Date("2026-11-28T00:00:00.000Z"),
          },
          ids.generate(),
          clock.now(),
        ),
        tenantId,
        tx,
      );
      for (const at of ["2026-11-20T08:00:00.000Z", "2026-11-25T09:30:00.000Z"]) {
        await sessions.save(
          Session.establish(
            UniqueEntityId.from(ids.generate()),
            {
              principalRef: internalId,
              refreshFingerprint: ids.generate(),
              expiresAt: new Date("2026-12-31T00:00:00.000Z"),
            },
            ids.generate(),
            new Date(at),
          ),
          tenantId,
          tx,
        );
      }
    });
    await credentials.save({
      tenantId,
      identifier: "staff:a@x.com",
      principalExternalId: externalId,
      passwordHash: "scrypt$secret",
    });

    const summaries = await principals.listSummaries(tenantId);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ id: internalId, externalId, status: "active" });
    expect(summaries[0]?.createdAt).toBeInstanceOf(Date);

    const active = await assignments.listActiveByTenant(tenantId, clock.now());
    expect(active.map((a) => a.roleKey).sort()).toEqual(["admin", "viewer"]);
    const later = await assignments.listActiveByTenant(
      tenantId,
      new Date("2026-11-29T00:00:00.000Z"),
    );
    expect(later.map((a) => a.roleKey)).toEqual(["admin"]); // the temporary viewer grant expired

    const latest = await sessions.lastEstablishedByPrincipals(tenantId, [internalId, "unknown"]);
    expect([...latest.entries()]).toEqual([[internalId, new Date("2026-11-25T09:30:00.000Z")]]);

    expect(await credentials.listByPrefix(tenantId, "staff:")).toEqual([
      { identifier: "staff:a@x.com", principalExternalId: externalId },
    ]);

    // another tenant sees none of it
    expect(await principals.listSummaries(otherTenant)).toEqual([]);
    expect(await assignments.listActiveByTenant(otherTenant, clock.now())).toEqual([]);
    expect((await sessions.lastEstablishedByPrincipals(otherTenant, [internalId])).size).toBe(0);
    expect(await credentials.listByPrefix(otherTenant, "staff:")).toEqual([]);
  });
});
