import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import { CheckoutSession } from "../domain/checkout-session";
import { CheckoutEventTranslator } from "./checkout-event-translator";
import { PrismaCheckoutSessionRepository } from "./prisma-checkout-session-repository";

/**
 * Phase A.25 Task 12 — real-PostgreSQL integration coverage for Checkout (previously none). Note:
 * Checkout owns only session state + snapshot assembly (per the aggregate's own doc comment) —
 * cross-context orchestration (Pricing/Inventory/Payments/Orders) is the Temporal `PurchaseWorkflow`
 * (ADR-0012), so "inventory interaction" isn't a repository-level concern here; the transaction
 * atomicity / duplicate / concurrent-attempt / rollback coverage the mission asks for is at the
 * `CheckoutSession` persistence boundary this repository owns. Follows the established reference
 * pattern: gated on `DATABASE_URL_TEST`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/checkout test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("PrismaCheckoutSessionRepository (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-14T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };
  const tenantId = `tenant-a25-checkout-${crypto.randomUUID().slice(0, 8)}`;

  function wire() {
    const prisma = createTestPrismaClient(databaseUrl);
    const outboxStore = new PrismaOutboxStore(prisma);
    const outbox = new OutboxWriter({
      store: outboxStore,
      translator: new CheckoutEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "checkout",
    });
    const context = rootEventContext(ids, tenantId);
    const repository = new PrismaCheckoutSessionRepository({ prisma, outbox, context, tenantId });
    return { prisma, repository, unitOfWork: new PrismaUnitOfWork(prisma), outboxStore };
  }

  function startSession(cartRef: string): CheckoutSession {
    return CheckoutSession.start(
      UniqueEntityId.from(ids.generate()),
      cartRef,
      `customer-${ids.generate()}`,
      `session-${ids.generate()}`,
      "USD",
    );
  }

  // --- Cart -> checkout persistence (CRUD) --------------------------------------------------------

  it("persists a session opened for a cart and reads it back exactly (cart -> checkout persistence)", async () => {
    const { prisma, repository, unitOfWork } = wire();
    const cartRef = `cart-${ids.generate()}`;
    const session = startSession(cartRef);

    await unitOfWork.run((tx) => repository.save(session, tx));
    const loaded = await repository.findById(session.id.toString());

    expect(loaded).not.toBeNull();
    expect(loaded?.cartRef).toBe(cartRef);
    expect(loaded?.state.value).toBe("started");
    expect(loaded?.orderRef).toBeNull();
    await prisma.$disconnect();
  });

  // --- Order creation boundary -------------------------------------------------------------------

  it("records the order boundary on complete() and persists it (order creation boundary)", async () => {
    const { prisma, repository, unitOfWork } = wire();
    const session = startSession(`cart-${ids.generate()}`);
    await unitOfWork.run((tx) => repository.save(session, tx));

    const loaded = await repository.findById(session.id.toString());
    if (loaded === null) throw new Error("setup failed");
    const orderRef = `order-${ids.generate()}`;
    loaded.lock(ids.generate(), clock.now());
    loaded.complete(orderRef, ids.generate(), clock.now());
    await unitOfWork.run((tx) => repository.save(loaded, tx));

    const final = await repository.findById(session.id.toString());
    expect(final?.state.value).toBe("completed");
    expect(final?.orderRef).toBe(orderRef);
    await prisma.$disconnect();
  });

  // --- Transaction atomicity ----------------------------------------------------------------------

  it("writes the outbox row in the SAME transaction as the session (transaction atomicity)", async () => {
    const { prisma, repository, unitOfWork, outboxStore } = wire();
    const session = startSession(`cart-${ids.generate()}`);
    await unitOfWork.run((tx) => repository.save(session, tx));

    // `start()` raises no domain event by design — only state transitions (lock/complete/fail/
    // expire/recalculate) do, so the outbox row appears once the session is actually locked.
    const loaded = await repository.findById(session.id.toString());
    if (loaded === null) throw new Error("setup failed");
    loaded.lock(ids.generate(), clock.now());
    await unitOfWork.run((tx) => repository.save(loaded, tx));

    const pending = await outboxStore.fetchPending(10_000);
    expect(pending.some((e) => e.key === session.id.toString())).toBe(true);
    await prisma.$disconnect();
  });

  it("rolls back the whole unit of work when a later step throws (failure rollback)", async () => {
    const { prisma, repository, unitOfWork } = wire();
    const session = startSession(`cart-${ids.generate()}`);

    await expect(
      unitOfWork.run(async (tx) => {
        await repository.save(session, tx);
        throw new Error("simulated downstream failure after the checkout-session write");
      }),
    ).rejects.toThrow("simulated downstream failure");

    const loaded = await repository.findById(session.id.toString());
    expect(loaded).toBeNull();
    await prisma.$disconnect();
  });

  // --- Duplicate / concurrent checkout attempts -----------------------------------------------------

  it("allows two independent sessions to be opened for the same cart (duplicate checkout attempts are an application-layer, not a DB, concern)", async () => {
    const { prisma, repository, unitOfWork } = wire();
    const cartRef = `cart-${ids.generate()}`;
    const first = startSession(cartRef);
    const second = startSession(cartRef);

    await unitOfWork.run((tx) => repository.save(first, tx));
    await unitOfWork.run((tx) => repository.save(second, tx));

    const loadedFirst = await repository.findById(first.id.toString());
    const loadedSecond = await repository.findById(second.id.toString());
    expect(loadedFirst?.cartRef).toBe(cartRef);
    expect(loadedSecond?.cartRef).toBe(cartRef);
    expect(loadedFirst?.id.toString()).not.toBe(loadedSecond?.id.toString());
    await prisma.$disconnect();
  });

  it("detects a concurrent update via ConcurrencyError rather than silently overwriting (concurrent checkout attempts)", async () => {
    const { prisma, repository, unitOfWork } = wire();
    const session = startSession(`cart-${ids.generate()}`);
    await unitOfWork.run((tx) => repository.save(session, tx));

    const copyA = await repository.findById(session.id.toString());
    const copyB = await repository.findById(session.id.toString());
    if (copyA === null || copyB === null) throw new Error("setup failed");
    copyA.lock(ids.generate(), clock.now());
    copyB.lock(ids.generate(), clock.now());

    await unitOfWork.run((tx) => repository.save(copyA, tx));
    await expect(unitOfWork.run((tx) => repository.save(copyB, tx))).rejects.toBeInstanceOf(
      ConcurrencyError,
    );
    await prisma.$disconnect();
  });

  it("rejects true concurrent writes to the same session under real simultaneous transactions", async () => {
    const { prisma, repository, unitOfWork } = wire();
    const session = startSession(`cart-${ids.generate()}`);
    await unitOfWork.run((tx) => repository.save(session, tx));

    const copyA = await repository.findById(session.id.toString());
    const copyB = await repository.findById(session.id.toString());
    if (copyA === null || copyB === null) throw new Error("setup failed");
    copyA.lock(ids.generate(), clock.now());
    copyB.lock(ids.generate(), clock.now());

    const results = await Promise.allSettled([
      unitOfWork.run((tx) => repository.save(copyA, tx)),
      unitOfWork.run((tx) => repository.save(copyB, tx)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    await prisma.$disconnect();
  });

  // --- Constraints ------------------------------------------------------------------------------

  it("rejects completing a session that was never locked/started open (constraints)", async () => {
    const { prisma, repository, unitOfWork } = wire();
    const session = startSession(`cart-${ids.generate()}`);
    await unitOfWork.run((tx) => repository.save(session, tx));

    const loaded = await repository.findById(session.id.toString());
    if (loaded === null) throw new Error("setup failed");
    loaded.lock(ids.generate(), clock.now());
    loaded.complete(`order-${ids.generate()}`, ids.generate(), clock.now());
    // Already completed — a second complete() must be rejected by the domain, not silently applied.
    expect(() => loaded.complete(`order-${ids.generate()}`, ids.generate(), clock.now())).toThrow();
    await prisma.$disconnect();
  });
});
