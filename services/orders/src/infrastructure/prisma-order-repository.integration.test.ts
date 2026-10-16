import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import { Order } from "../domain/order";
import { OrderItem } from "../domain/order-item";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";
import { OrderEventTranslator } from "./order-event-translator";
import { PrismaOrderRepository } from "./prisma-order-repository";

/**
 * REFERENCE integration suite for the Sprint-2.2 Prisma adapters (all contexts follow this
 * pattern). Requires a real PostgreSQL with the initial migration applied:
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/orders test
 *
 * HONESTLY GATED: without `DATABASE_URL_TEST` the suite is skipped — never faked. This
 * environment has no database host (PROJECT_STATE), so first execution happens on the first
 * Docker-capable session, before anything builds on the adapters.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

function unwrap<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok || result.value === undefined) throw new Error("test setup: invalid VO");
  return result.value;
}

describe.runIf(Boolean(databaseUrl))("PrismaOrderRepository (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-07-05T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };

  function wire() {
    const prisma = createTestPrismaClient(databaseUrl);
    const outboxStore = new PrismaOutboxStore(prisma);
    const outbox = new OutboxWriter({
      store: outboxStore,
      translator: new OrderEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "orders",
    });
    const tenantId = "tenant-itest";
    const context = rootEventContext(ids);
    const repository = new PrismaOrderRepository({ prisma, outbox, context });
    return { prisma, repository, unitOfWork: new PrismaUnitOfWork(prisma), outboxStore, tenantId };
  }

  function placeOrder(): Order {
    const unitPrice = unwrap(Money.create(1999, "USD"));
    const snapshot = unwrap(ProductSnapshot.create(crypto.randomUUID(), "Toy Wagon", unitPrice));
    const item = OrderItem.create(UniqueEntityId.from(ids.generate()), snapshot, 2);
    return Order.place(
      UniqueEntityId.from(ids.generate()),
      unwrap(OrderNumber.create(`ORD-${ids.generate()}`)),
      crypto.randomUUID(),
      "USD",
      [item],
      unwrap(AddressSnapshot.create("1 Main St", "Town", "12345", "US")),
      ids.generate(),
      clock.now(),
    );
  }

  it("round-trips the aggregate exactly: items, address, derived status, version", async () => {
    const { prisma, repository, unitOfWork, tenantId } = wire();
    const order = placeOrder();

    await unitOfWork.run(async (tx) => repository.save(order, tenantId, tx));
    const loaded = await repository.findById(order.id.toString(), tenantId);

    expect(loaded).not.toBeNull();
    expect(loaded?.status).toBe("placed"); // derived from history rows, never stored
    expect(loaded?.version).toBe(1);
    expect(loaded?.totalAmount().amountMinor).toBe(3998);
    expect(loaded?.items).toHaveLength(1);
    expect(loaded?.shippingAddress.city).toBe("Town");
    await prisma.$disconnect();
  });

  it("writes the outbox row in the SAME transaction as the aggregate", async () => {
    const { prisma, repository, unitOfWork, outboxStore, tenantId } = wire();
    const order = placeOrder();

    await unitOfWork.run(async (tx) => repository.save(order, tenantId, tx));
    const pending = await outboxStore.fetchPending(100);

    expect(pending.some((entry) => entry.key === order.id.toString())).toBe(true);
    await prisma.$disconnect();
  });

  it("rejects a stale write with ConcurrencyError (no retry, no silent overwrite)", async () => {
    const { prisma, repository, unitOfWork, tenantId } = wire();
    const order = placeOrder();
    await unitOfWork.run(async (tx) => repository.save(order, tenantId, tx));

    const first = await repository.findById(order.id.toString(), tenantId);
    const second = await repository.findById(order.id.toString(), tenantId);
    if (first === null || second === null) throw new Error("setup failed");
    first.markPaid(crypto.randomUUID(), ids.generate(), clock.now());
    second.markPaid(crypto.randomUUID(), ids.generate(), clock.now());

    await unitOfWork.run(async (tx) => repository.save(first, tenantId, tx));
    await expect(
      unitOfWork.run(async (tx) => repository.save(second, tenantId, tx)),
    ).rejects.toBeInstanceOf(ConcurrencyError);
    await prisma.$disconnect();
  });

  describe("list", () => {
    // `crypto.randomUUID()` (v4, random) is fine for the tests above, which never depend on
    // ordering — but `list()` sorts on `id`, relying on real ids being UUIDv7 (time-ordered,
    // D-022). This monotonic generator reproduces that property so "most recent first" is
    // actually verifiable against a real database, scoped to this block only.
    //
    // Phase A.20 (Task 9): the id/tenant prefix used to be the literal constant
    // `00000000-0000-7000-8000-`, so every test run wrote the identical rows — against the
    // in-memory repository (pre-A.19) that was harmless, but against a real, persistent database
    // it means a second run collides with the first: "returns an empty page for a tenant with no
    // orders" starts failing (the deterministic tenant already has leftover orders) and "pages
    // most-recently-placed first" fails on a primary-key unique-constraint violation. A random
    // per-suite-run prefix keeps ids unique across runs while ids generated *within* one run stay
    // monotonically increasing (only the trailing counter changes), which is all the ordering
    // assertion actually needs.
    function monotonicIds(): IdGenerator {
      const runPrefix = crypto.randomUUID().slice(0, 8);
      let n = 0;
      return {
        generate: () => `${runPrefix}-0000-7000-8000-${(n++).toString().padStart(12, "0")}`,
      };
    }

    function wireList(ids: IdGenerator) {
      const prisma = createTestPrismaClient(databaseUrl);
      const outbox = new OutboxWriter({
        store: new PrismaOutboxStore(prisma),
        translator: new OrderEventTranslator(),
        serializer: new InMemoryEventSerializer(),
        clock,
        producer: "orders",
      });
      const tenantId = `tenant-list-itest-${ids.generate()}`;
      const context = rootEventContext(ids);
      const repository = new PrismaOrderRepository({ prisma, outbox, context });
      return { prisma, repository, unitOfWork: new PrismaUnitOfWork(prisma), tenantId, ids };
    }

    function placeOrderWith(ids: IdGenerator): Order {
      const unitPrice = unwrap(Money.create(1999, "USD"));
      const snapshot = unwrap(ProductSnapshot.create(ids.generate(), "Toy Wagon", unitPrice));
      const item = OrderItem.create(UniqueEntityId.from(ids.generate()), snapshot, 1);
      return Order.place(
        UniqueEntityId.from(ids.generate()),
        unwrap(OrderNumber.create(`ORD-${ids.generate()}`)),
        "customer-1",
        "USD",
        [item],
        unwrap(AddressSnapshot.create("1 Main St", "Town", "12345", "US")),
        ids.generate(),
        clock.now(),
      );
    }

    it("returns an empty page for a tenant with no orders", async () => {
      const { prisma, repository, tenantId } = wireList(monotonicIds());
      const page = await repository.list({}, tenantId);
      expect(page).toEqual({ items: [], pageInfo: { hasNextPage: false, endCursor: null } });
      await prisma.$disconnect();
    });

    it("pages most-recently-placed first and is tenant-scoped", async () => {
      const ids = monotonicIds();
      const { prisma, repository, unitOfWork, tenantId } = wireList(ids);
      const first = placeOrderWith(ids);
      await unitOfWork.run((tx) => repository.save(first, tenantId, tx));
      const second = placeOrderWith(ids);
      await unitOfWork.run((tx) => repository.save(second, tenantId, tx));
      const third = placeOrderWith(ids);
      await unitOfWork.run((tx) => repository.save(third, tenantId, tx));

      const page1 = await repository.list({ first: 2 }, tenantId);
      expect(page1.items.map((o) => o.id.toString())).toEqual([
        third.id.toString(),
        second.id.toString(),
      ]);
      expect(page1.pageInfo.hasNextPage).toBe(true);
      expect(page1.pageInfo.endCursor).not.toBeNull();

      const page2 = await repository.list(
        {
          first: 2,
          after: page1.pageInfo.endCursor ?? undefined,
        },
        tenantId,
      );
      expect(page2.items.map((o) => o.id.toString())).toEqual([first.id.toString()]);
      expect(page2.pageInfo.hasNextPage).toBe(false);
      await prisma.$disconnect();
    });
  });
});
