import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import { Credit } from "../domain/credit";
import { Subscription } from "../domain/subscription";
import { LicensingEventTranslator } from "./licensing-event-translator";
import { PrismaCreditRepository, PrismaSubscriptionRepository } from "./prisma-repositories";

/**
 * Phase A.25 Task 10 — real-PostgreSQL integration coverage for Licensing (previously none).
 * Follows the established reference pattern (see PrismaOrderRepository's integration suite):
 * gated on `DATABASE_URL_TEST`, skipped (never faked) without it.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/licensing test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("Prisma Licensing repositories (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-14T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };
  const tenantId = `tenant-a25-licensing-${crypto.randomUUID().slice(0, 8)}`;

  function wire() {
    const prisma = createTestPrismaClient(databaseUrl);
    const outboxStore = new PrismaOutboxStore(prisma);
    const outbox = new OutboxWriter({
      store: outboxStore,
      translator: new LicensingEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "licensing",
    });
    const context = rootEventContext(ids, tenantId);
    const credits = new PrismaCreditRepository({ prisma, outbox, context, tenantId });
    const subscriptions = new PrismaSubscriptionRepository({ prisma, outbox, context, tenantId });
    return {
      prisma,
      credits,
      subscriptions,
      unitOfWork: new PrismaUnitOfWork(prisma),
      outboxStore,
    };
  }

  function grantCredit(tenantRef: string): Credit {
    return Credit.grant(
      UniqueEntityId.from(ids.generate()),
      tenantRef,
      1000,
      "signup bonus",
      ids.generate(),
      clock.now(),
    );
  }

  function startTrial(tenantRef: string): Subscription {
    return Subscription.startTrial(
      UniqueEntityId.from(ids.generate()),
      tenantRef,
      `plan-version-${ids.generate()}`,
      ids.generate(),
      clock.now(),
    );
  }

  // --- CRUD -----------------------------------------------------------------------------------

  it("creates and reads a Credit back exactly (create)", async () => {
    const { prisma, credits, unitOfWork } = wire();
    const credit = grantCredit(`tenant-ref-${ids.generate()}`);

    await unitOfWork.run((tx) => credits.save(credit, tx));
    const loaded = await credits.findById(credit.id.toString(), tenantId);

    expect(loaded).not.toBeNull();
    expect(loaded?.amount).toBe(1000);
    expect(loaded?.status).toBe("granted");
    await prisma.$disconnect();
  });

  it("updates an existing Credit on consume (update)", async () => {
    const { prisma, credits, unitOfWork } = wire();
    const credit = grantCredit(`tenant-ref-${ids.generate()}`);
    await unitOfWork.run((tx) => credits.save(credit, tx));

    const loaded = await credits.findById(credit.id.toString(), tenantId);
    if (loaded === null) throw new Error("setup failed");
    loaded.consume(400, ids.generate(), clock.now());
    await unitOfWork.run((tx) => credits.save(loaded, tx));

    const reloaded = await credits.findById(credit.id.toString(), tenantId);
    expect(reloaded?.amount).toBe(600);
    expect(reloaded?.status).toBe("granted");
    expect(reloaded?.version).toBe(2);
    await prisma.$disconnect();
  });

  // --- Constraints ------------------------------------------------------------------------------

  it("enforces the unique (tenantId, tenantRef) Subscription constraint (constraints)", async () => {
    const { prisma, subscriptions, unitOfWork } = wire();
    const tenantRef = `tenant-ref-dup-${ids.generate()}`;
    await unitOfWork.run((tx) => subscriptions.save(startTrial(tenantRef), tx));

    await expect(
      unitOfWork.run((tx) => subscriptions.save(startTrial(tenantRef), tx)),
    ).rejects.toThrow();
    await prisma.$disconnect();
  });

  // --- Transaction commit / rollback / failure atomicity -----------------------------------------

  it("writes the outbox row in the SAME transaction as the aggregate (transaction commit)", async () => {
    const { prisma, credits, unitOfWork, outboxStore } = wire();
    const credit = grantCredit(`tenant-ref-${ids.generate()}`);

    await unitOfWork.run((tx) => credits.save(credit, tx));

    const pending = await outboxStore.fetchPending(10_000);
    expect(pending.some((e) => e.key === credit.id.toString())).toBe(true);
    await prisma.$disconnect();
  });

  it("rolls back the whole unit of work when a later step throws (transaction rollback / failure atomicity)", async () => {
    const { prisma, credits, unitOfWork } = wire();
    const credit = grantCredit(`tenant-ref-${ids.generate()}`);

    await expect(
      unitOfWork.run(async (tx) => {
        await credits.save(credit, tx);
        throw new Error("simulated downstream failure after the credit write");
      }),
    ).rejects.toThrow("simulated downstream failure");

    const loaded = await credits.findById(credit.id.toString(), tenantId);
    expect(loaded).toBeNull(); // the aborted transaction left nothing behind
    await prisma.$disconnect();
  });

  // --- Concurrent update / stale write -----------------------------------------------------------

  it("detects a concurrent update via ConcurrencyError rather than silently overwriting (concurrent update / stale write)", async () => {
    const { prisma, credits, unitOfWork } = wire();
    const credit = grantCredit(`tenant-ref-${ids.generate()}`);
    await unitOfWork.run((tx) => credits.save(credit, tx));

    const copyA = await credits.findById(credit.id.toString(), tenantId);
    const copyB = await credits.findById(credit.id.toString(), tenantId);
    if (copyA === null || copyB === null) throw new Error("setup failed");
    copyA.consume(100, ids.generate(), clock.now());
    copyB.consume(200, ids.generate(), clock.now());

    await unitOfWork.run((tx) => credits.save(copyA, tx));
    await expect(unitOfWork.run((tx) => credits.save(copyB, tx))).rejects.toBeInstanceOf(
      ConcurrencyError,
    );

    const final = await credits.findById(credit.id.toString(), tenantId);
    expect(final?.amount).toBe(900); // only A's consume applied
    await prisma.$disconnect();
  });

  it("rejects true concurrent writes to the same Credit under real simultaneous transactions", async () => {
    const { prisma, credits, unitOfWork } = wire();
    const credit = grantCredit(`tenant-ref-${ids.generate()}`);
    await unitOfWork.run((tx) => credits.save(credit, tx));

    const copyA = await credits.findById(credit.id.toString(), tenantId);
    const copyB = await credits.findById(credit.id.toString(), tenantId);
    if (copyA === null || copyB === null) throw new Error("setup failed");
    copyA.consume(50, ids.generate(), clock.now());
    copyB.consume(75, ids.generate(), clock.now());

    const results = await Promise.allSettled([
      unitOfWork.run((tx) => credits.save(copyA, tx)),
      unitOfWork.run((tx) => credits.save(copyB, tx)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    await prisma.$disconnect();
  });

  // --- Idempotency ------------------------------------------------------------------------------

  it("never silently duplicates a Credit written twice with the same id (idempotency)", async () => {
    const { prisma, credits, unitOfWork } = wire();
    const credit = grantCredit(`tenant-ref-${ids.generate()}`);
    await unitOfWork.run((tx) => credits.save(credit, tx));

    // Same aggregate, version still 0 in this in-memory copy → repository attempts a second
    // `create`, which must fail on the primary key rather than silently duplicating the row.
    await expect(unitOfWork.run((tx) => credits.save(credit, tx))).rejects.toThrow();
    await prisma.$disconnect();
  });
});
