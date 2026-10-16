import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaUnitOfWork } from "@platform/db";
import type { TransactionClient } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { PrismaOutboxStore } from "@platform/db";
import { ConcurrencyError } from "@platform/utils";
import { AuditChain } from "../domain/audit-chain";
import { Principal } from "../domain/principal";
import { PrismaAuditLedgerRepository, PrismaPrincipalRepository } from "./prisma-repositories";
import { SecurityEventTranslator } from "./security-event-translator";

/**
 * Integration suite for the Security Prisma adapters (Phase-2 hardening G-SEC-1). Requires a real
 * PostgreSQL with the `20260718000000_security_platform_p2_0` migration applied:
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/security test
 *
 * HONESTLY GATED: without `DATABASE_URL_TEST` the suite is skipped — never faked. CI provisions a
 * Postgres service + runs `prisma migrate deploy` before this runs. Client creation is lazy (inside
 * `wire`, per `it`) so gating never connects.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("Prisma security repositories (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-07-18T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };
  const tenantId = "tenant-sec-itest";

  function wire() {
    const prisma = createTestPrismaClient(databaseUrl);
    const outbox = new OutboxWriter<TransactionClient>({
      store: new PrismaOutboxStore(prisma),
      translator: new SecurityEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "security",
    });
    const context = rootEventContext(ids);
    const deps = { prisma, outbox, context };
    return {
      prisma,
      uow: new PrismaUnitOfWork(prisma),
      principals: new PrismaPrincipalRepository(deps),
      audit: new PrismaAuditLedgerRepository(deps),
    };
  }

  it("persists a principal and reads it back", async () => {
    const { uow, principals } = wire();
    const externalId = `svc-${ids.generate()}`;
    await uow.run(async (tx) => {
      const p = Principal.register(
        UniqueEntityId.from(ids.generate()),
        { externalId, kind: "service_account", displayName: "Svc" },
        ids.generate(),
        clock.now(),
      );
      await principals.save(p, tenantId, tx);
    });
    const back = await principals.findByExternalId(externalId, tenantId);
    expect(back?.externalId).toBe(externalId);
    expect(back?.kind).toBe("service_account");
  });

  it("enforces optimistic concurrency", async () => {
    const { uow, principals } = wire();
    const externalId = `svc-${ids.generate()}`;
    const id = UniqueEntityId.from(ids.generate());
    await uow.run(async (tx) =>
      principals.save(
        Principal.register(
          id,
          { externalId, kind: "machine", displayName: "M" },
          ids.generate(),
          clock.now(),
        ),
        tenantId,
        tx,
      ),
    );

    const loaded = await principals.findByExternalId(externalId, tenantId); // version 1
    if (loaded === null) throw new Error("setup");
    loaded.suspend(ids.generate(), clock.now());
    await uow.run(async (tx) => principals.save(loaded, tenantId, tx)); // DB advances to version 2

    // `loaded` still carries version 1 — a second save is a stale write and must conflict.
    loaded.activate(ids.generate(), clock.now());
    await expect(
      uow.run(async (tx) => principals.save(loaded, tenantId, tx)),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it("appends and verifies a WORM audit chain", async () => {
    const { uow, audit } = wire();
    const chain = new AuditChain();
    const scope = `scope-${ids.generate()}`;
    await uow.run(async (tx) => {
      const tail = await audit.tail(scope, tenantId, tx);
      const r1 = chain.append(tail, {
        id: ids.generate(),
        principalRef: "svc",
        action: "a:b",
        decision: "allow",
        occurredAt: clock.now().toISOString(),
        tenantRef: scope,
      });
      await audit.append(r1, tenantId, tx);
      const r2 = chain.append(r1, {
        id: ids.generate(),
        principalRef: "svc",
        action: "a:c",
        decision: "allow",
        occurredAt: clock.now().toISOString(),
        tenantRef: scope,
      });
      await audit.append(r2, tenantId, tx);
    });
    const records = await audit.list(scope, tenantId);
    expect(records).toHaveLength(2);
    expect(chain.verify(records).valid).toBe(true);
  });

  it("enforces WORM at the database (UPDATE/DELETE on audit_records are rejected)", async () => {
    const { prisma, uow, audit } = wire();
    const scope = `scope-${ids.generate()}`;
    let recordId = "";
    await uow.run(async (tx) => {
      const r = new AuditChain().append(null, {
        id: ids.generate(),
        principalRef: "x",
        action: "a:b",
        decision: "allow",
        occurredAt: clock.now().toISOString(),
        tenantRef: scope,
      });
      recordId = r.id;
      await audit.append(r, tenantId, tx);
    });
    const raw = prisma as {
      $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
    };
    await expect(
      raw.$executeRawUnsafe(
        'UPDATE "security"."audit_records" SET decision = $1 WHERE id = $2',
        "deny",
        recordId,
      ),
    ).rejects.toThrow();
    await expect(
      raw.$executeRawUnsafe('DELETE FROM "security"."audit_records" WHERE id = $1', recordId),
    ).rejects.toThrow();
  });
});
