import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import { PaymentIntent } from "../domain/payment-intent";
import { PspToken } from "../domain/value-objects/psp-token";
import { PaymentEventTranslator } from "./payment-event-translator";
import { PrismaPaymentIntentRepository } from "./prisma-payment-intent-repository";

/**
 * Phase A.22 (Task 10) — real PostgreSQL integration coverage for Payments, selected as a
 * highest-risk context per the Task 9 inventory (financial write path, optimistic concurrency,
 * idempotency-keyed refunds) that previously had zero `*.integration.test.ts` coverage — only
 * Orders/Security/Customer-360 did (A.21 finding). Follows the same reference pattern as
 * `services/orders/src/infrastructure/prisma-order-repository.integration.test.ts`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/payments test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

function unwrap<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok || result.value === undefined) throw new Error("test setup: invalid VO");
  return result.value;
}

describe.runIf(Boolean(databaseUrl))("PrismaPaymentIntentRepository (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-14T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };

  function wire(tenantId = "tenant-itest-payments") {
    const prisma = createTestPrismaClient(databaseUrl);
    const outboxStore = new PrismaOutboxStore(prisma);
    const outbox = new OutboxWriter({
      store: outboxStore,
      translator: new PaymentEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "payments",
    });
    const context = rootEventContext(ids);
    const repository = new PrismaPaymentIntentRepository({ prisma, outbox, context });
    return { prisma, repository, unitOfWork: new PrismaUnitOfWork(prisma), outboxStore, tenantId };
  }

  function newIntent(orderRef = crypto.randomUUID()): PaymentIntent {
    const amount = unwrap(Money.create(5000, "USD"));
    return PaymentIntent.create(UniqueEntityId.from(ids.generate()), orderRef, amount);
  }

  it("round-trips the aggregate exactly: amount, status, version", async () => {
    const { prisma, repository, unitOfWork, tenantId } = wire();
    const intent = newIntent();

    await unitOfWork.run(async (tx) => repository.save(intent, tenantId, tx));
    const loaded = await repository.findById(intent.id.toString(), tenantId);

    expect(loaded).not.toBeNull();
    expect(loaded?.status.value).toBe("requires_payment");
    expect(loaded?.version).toBe(1);
    expect(loaded?.amount.amountMinor).toBe(5000);
    expect(loaded?.amount.currency).toBe("USD");
    await prisma.$disconnect();
  });

  it("writes the outbox row in the SAME transaction as the aggregate (capture path)", async () => {
    // Queries the outbox row directly by key rather than through `fetchPending(100)`: `lumo_test`
    // accumulates pending rows across every integration suite run (C-08 — CDC never marks rows
    // published, so nothing prunes them), and `fetchPending` orders oldest-first, so a freshly
    // written row can fall outside a fixed-size page once the backlog exceeds it. Confirmed live:
    // 123 pre-existing pending rows in `lumo_test` at the time this test was authored.
    const { prisma, repository, unitOfWork, tenantId } = wire();
    const intent = newIntent();
    await unitOfWork.run(async (tx) => repository.save(intent, tenantId, tx));

    const loaded = await repository.findById(intent.id.toString(), tenantId);
    if (loaded === null) throw new Error("setup failed");
    loaded.capture(unwrap(PspToken.create("tok_visa_4242")), ids.generate(), clock.now());
    await unitOfWork.run(async (tx) => repository.save(loaded, tenantId, tx));

    const rows = await prisma.outboxEntry.findMany({ where: { key: intent.id.toString() } });
    expect(rows.some((entry) => entry.topic.startsWith("payments.payment_intent.captured"))).toBe(
      true,
    );
    expect(rows.every((entry) => entry.status === "pending")).toBe(true); // CDC-drained, never marked by app code
    await prisma.$disconnect();
  });

  it("rejects a stale write with ConcurrencyError (no retry, no silent overwrite)", async () => {
    const { prisma, repository, unitOfWork, tenantId } = wire();
    const intent = newIntent();
    await unitOfWork.run(async (tx) => repository.save(intent, tenantId, tx));

    const first = await repository.findById(intent.id.toString(), tenantId);
    const second = await repository.findById(intent.id.toString(), tenantId);
    if (first === null || second === null) throw new Error("setup failed");
    first.capture(unwrap(PspToken.create("tok_a")), ids.generate(), clock.now());
    second.fail("card_declined", ids.generate(), clock.now());

    await unitOfWork.run(async (tx) => repository.save(first, tenantId, tx));
    await expect(
      unitOfWork.run(async (tx) => repository.save(second, tenantId, tx)),
    ).rejects.toBeInstanceOf(ConcurrencyError);

    // Confirm no partial state: reload shows only the winner's transition applied.
    const reloaded = await repository.findById(intent.id.toString(), tenantId);
    expect(reloaded?.status.value).toBe("captured");
    expect(reloaded?.version).toBe(2);
    await prisma.$disconnect();
  });

  it("enforces the (tenantId, idempotencyKey) unique constraint at the database level", async () => {
    const { prisma } = wire();
    const tenantId = `tenant-itest-idem-${crypto.randomUUID()}`;
    const key = "shared-idempotency-key";
    const orderRef = crypto.randomUUID();

    await prisma.paymentIntent.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        orderRef,
        amountMinor: 1000,
        currency: "USD",
        status: "requires_payment",
        idempotencyKey: key,
        paymentMethod: {},
      },
    });

    await expect(
      prisma.paymentIntent.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          orderRef: crypto.randomUUID(),
          amountMinor: 2000,
          currency: "USD",
          status: "requires_payment",
          idempotencyKey: key,
          paymentMethod: {},
        },
      }),
    ).rejects.toThrow();

    const count = await prisma.paymentIntent.count({ where: { tenantId, idempotencyKey: key } });
    expect(count).toBe(1); // the conflicting insert left no partial row
    await prisma.$disconnect();
  });

  it("BEGIN/ROLLBACK: an aborted transaction leaves no trace in a fresh session", async () => {
    const { prisma, repository } = wire();
    const intent = newIntent();

    await expect(
      prisma.$transaction(async (tx) => {
        await repository.save(intent, tx as unknown as Parameters<typeof repository.save>[1]);
        throw new Error("forced rollback");
      }),
    ).rejects.toThrow("forced rollback");

    const freshSession = createTestPrismaClient(databaseUrl);
    const found = await freshSession.paymentIntent.findUnique({
      where: { id: intent.id.toString() },
    });
    expect(found).toBeNull();
    await freshSession.$disconnect();
    await prisma.$disconnect();
  });

  it("BEGIN/COMMIT: a committed transaction is durable in a fresh session", async () => {
    const { prisma, repository, unitOfWork, tenantId } = wire();
    const intent = newIntent();
    await unitOfWork.run(async (tx) => repository.save(intent, tenantId, tx));

    const freshSession = createTestPrismaClient(databaseUrl);
    const found = await freshSession.paymentIntent.findUnique({
      where: { id: intent.id.toString() },
    });
    expect(found).not.toBeNull();
    expect(found?.status).toBe("requires_payment");
    await freshSession.$disconnect();
    await prisma.$disconnect();
  });

  it("failure atomicity: a second write in the same transaction throwing leaves NEITHER write committed", async () => {
    const { prisma, tenantId } = wire();
    const intentId = crypto.randomUUID();
    const orderRef = crypto.randomUUID();

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.paymentIntent.create({
          data: {
            id: intentId,
            tenantId,
            orderRef,
            amountMinor: 1000,
            currency: "USD",
            status: "requires_payment",
            paymentMethod: {},
          },
        });
        // Write B: violates the FK on intentId (references a non-existent charge target would not
        // fail here; instead force a genuine constraint failure — duplicate PK on a second insert).
        await tx.paymentIntent.create({
          data: {
            id: intentId, // same PK -> unique violation
            tenantId,
            orderRef,
            amountMinor: 1000,
            currency: "USD",
            status: "requires_payment",
            paymentMethod: {},
          },
        });
      }),
    ).rejects.toThrow();

    const found = await prisma.paymentIntent.findUnique({ where: { id: intentId } });
    expect(found).toBeNull(); // write A did not survive write B's failure
    await prisma.$disconnect();
  });

  describe("concurrency: two genuinely concurrent sessions", () => {
    it("racing capture() against the same version: exactly one wins, zero lost updates", async () => {
      const { prisma, repository, unitOfWork, tenantId } = wire();
      const intent = newIntent();
      await unitOfWork.run(async (tx) => repository.save(intent, tenantId, tx));

      const sessionA = createTestPrismaClient(databaseUrl);
      const sessionB = createTestPrismaClient(databaseUrl);
      try {
        const [a, b] = await Promise.all([
          sessionA.paymentIntent.updateMany({
            where: { id: intent.id.toString(), version: 1 },
            data: { status: "captured", version: { increment: 1 } },
          }),
          sessionB.paymentIntent.updateMany({
            where: { id: intent.id.toString(), version: 1 },
            data: { status: "failed", version: { increment: 1 } },
          }),
        ]);
        const totalUpdated = a.count + b.count;
        expect(totalUpdated).toBe(1); // exactly one of the two racing updates matched

        const final = await prisma.paymentIntent.findUnique({
          where: { id: intent.id.toString() },
        });
        expect(final?.version).toBe(2);
        expect(["captured", "failed"]).toContain(final?.status);
      } finally {
        await sessionA.$disconnect();
        await sessionB.$disconnect();
        await prisma.$disconnect();
      }
    });

    it("concurrent creation with the same (tenantId, idempotencyKey): exactly one succeeds", async () => {
      const { prisma, tenantId } = wire(`tenant-itest-concurrent-idem-${crypto.randomUUID()}`);
      const key = "concurrent-shared-key";
      const sessionA = createTestPrismaClient(databaseUrl);
      const sessionB = createTestPrismaClient(databaseUrl);
      try {
        const attempt = (client: typeof sessionA, orderRef: string) =>
          client.paymentIntent.create({
            data: {
              id: crypto.randomUUID(),
              tenantId,
              orderRef,
              amountMinor: 1000,
              currency: "USD",
              status: "requires_payment",
              idempotencyKey: key,
              paymentMethod: {},
            },
          });

        const results = await Promise.allSettled([
          attempt(sessionA, crypto.randomUUID()),
          attempt(sessionB, crypto.randomUUID()),
        ]);
        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);

        const count = await prisma.paymentIntent.count({
          where: { tenantId, idempotencyKey: key },
        });
        expect(count).toBe(1);
      } finally {
        await sessionA.$disconnect();
        await sessionB.$disconnect();
        await prisma.$disconnect();
      }
    });
  });
});
