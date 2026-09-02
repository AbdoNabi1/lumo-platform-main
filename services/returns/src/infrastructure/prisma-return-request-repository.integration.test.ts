import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { ProductRef, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import { ReturnRequest } from "../domain/return-request";
import { RefundDecision } from "../domain/value-objects/refund-decision";
import { ReturnItem } from "../domain/value-objects/return-item";
import { ReturnReason } from "../domain/value-objects/return-reason";
import { ReturnsEventTranslator } from "./returns-event-translator";
import { PrismaReturnRequestRepository } from "./prisma-return-request-repository";

/**
 * Phase A.25 Task 11 — real-PostgreSQL integration coverage for Returns (previously none). Extra
 * attention to the refund/idempotency behavior A.19-A.21 validated at the Payments/refund layer:
 * here, the concern is that Returns' OWN append-only attempts trail and optimistic locking hold up
 * against a real database. Follows the established reference pattern: gated on `DATABASE_URL_TEST`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/returns test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

function unwrap<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok || result.value === undefined) throw new Error("test setup: invalid VO");
  return result.value;
}

describe.runIf(Boolean(databaseUrl))("PrismaReturnRequestRepository (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-14T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };
  const tenantId = `tenant-a25-returns-${crypto.randomUUID().slice(0, 8)}`;

  function wire() {
    const prisma = createTestPrismaClient(databaseUrl);
    const outboxStore = new PrismaOutboxStore(prisma);
    const outbox = new OutboxWriter({
      store: outboxStore,
      translator: new ReturnsEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "returns",
    });
    const context = rootEventContext(ids, tenantId);
    const repository = new PrismaReturnRequestRepository({ prisma, outbox, context, tenantId });
    return { prisma, repository, unitOfWork: new PrismaUnitOfWork(prisma), outboxStore };
  }

  function returnItem(orderItemRef: string): ReturnItem {
    const productRef = unwrap(ProductRef.create(`product-${ids.generate()}`));
    const reason = unwrap(ReturnReason.create("defective"));
    return ReturnItem.create(
      UniqueEntityId.from(ids.generate()),
      orderItemRef,
      productRef,
      1,
      reason,
    );
  }

  function newReturnRequest(): ReturnRequest {
    const orderItemRef = `order-item-${ids.generate()}`;
    return ReturnRequest.create(UniqueEntityId.from(ids.generate()), `order-${ids.generate()}`, [
      returnItem(orderItemRef),
    ]);
  }

  // --- CRUD -----------------------------------------------------------------------------------

  it("creates and reads a ReturnRequest back exactly (create)", async () => {
    const { prisma, repository, unitOfWork } = wire();
    const rr = newReturnRequest();

    await unitOfWork.run((tx) => repository.save(rr, tx));
    const loaded = await repository.findById(rr.id.toString());

    expect(loaded).not.toBeNull();
    expect(loaded?.status.value).toBe("requested");
    expect(loaded?.items).toHaveLength(1);
    await prisma.$disconnect();
  });

  // --- Status transitions ------------------------------------------------------------------------

  it("persists status transitions across saves (update)", async () => {
    const { prisma, repository, unitOfWork } = wire();
    const rr = newReturnRequest();
    await unitOfWork.run((tx) => repository.save(rr, tx));

    const loaded = await repository.findById(rr.id.toString());
    if (loaded === null) throw new Error("setup failed");
    loaded.approve(ids.generate(), clock.now());
    await unitOfWork.run((tx) => repository.save(loaded, tx));

    const reloaded = await repository.findById(rr.id.toString());
    expect(reloaded?.status.value).toBe("approved");
    expect(reloaded?.version).toBe(2);
    await prisma.$disconnect();
  });

  // --- Refund relationship ----------------------------------------------------------------------

  it("walks the full RMA lifecycle to a refund decision and reads the relationship back (refund relationship)", async () => {
    const { prisma, repository, unitOfWork } = wire();
    const orderItemRef = `order-item-${ids.generate()}`;
    let rr = ReturnRequest.create(UniqueEntityId.from(ids.generate()), `order-${ids.generate()}`, [
      returnItem(orderItemRef),
    ]);
    await unitOfWork.run((tx) => repository.save(rr, tx));

    rr = (await repository.findById(rr.id.toString()))!;
    rr.approve(ids.generate(), clock.now());
    rr.generateRma(`RMA-${ids.generate()}`, ids.generate(), clock.now());
    await unitOfWork.run((tx) => repository.save(rr, tx));

    rr = (await repository.findById(rr.id.toString()))!;
    rr.receivePackage(ids.generate(), clock.now());
    rr.inspectItem(orderItemRef, true, clock.now());
    rr.completeInspection(ids.generate(), clock.now());
    await unitOfWork.run((tx) => repository.save(rr, tx));

    rr = (await repository.findById(rr.id.toString()))!;
    rr.acceptItems([], ids.generate(), clock.now());
    const decision = unwrap(RefundDecision.create("refund", 2500, "USD"));
    rr.decideResolution(decision, ids.generate(), clock.now());
    await unitOfWork.run((tx) => repository.save(rr, tx));

    const final = await repository.findById(rr.id.toString());
    expect(final?.status.value).toBe("refund_requested");
    expect(final?.refundDecision?.outcome).toBe("refund");
    expect(final?.refundDecision?.amountMinor).toBe(2500);
    // The append-only attempts trail records every step exactly once — the observability
    // guarantee the repository's doc comment ("attempts are append-only... never rewritten") is for.
    expect(final?.attempts.map((a) => a.kind)).toEqual([
      "approval",
      "rma",
      "receive",
      "inspection",
      "accept",
      "resolution",
    ]);
    await prisma.$disconnect();
  });

  // --- Constraints / rollback / failure atomicity ------------------------------------------------

  it("rejects an invalid transition rather than silently accepting it (constraints)", async () => {
    const { prisma, repository, unitOfWork } = wire();
    const rr = newReturnRequest();
    await unitOfWork.run((tx) => repository.save(rr, tx));

    const loaded = await repository.findById(rr.id.toString());
    if (loaded === null) throw new Error("setup failed");
    // `requested` cannot jump straight to `rma_generated` — must go through `approved` first.
    expect(() => loaded.generateRma("RMA-X", ids.generate(), clock.now())).toThrow();
    await prisma.$disconnect();
  });

  it("rolls back the whole unit of work when a later step throws (transaction rollback / failure atomicity)", async () => {
    const { prisma, repository, unitOfWork } = wire();
    const rr = newReturnRequest();

    await expect(
      unitOfWork.run(async (tx) => {
        await repository.save(rr, tx);
        throw new Error("simulated downstream failure after the return-request write");
      }),
    ).rejects.toThrow("simulated downstream failure");

    const loaded = await repository.findById(rr.id.toString());
    expect(loaded).toBeNull();
    await prisma.$disconnect();
  });

  // --- Concurrent operations ----------------------------------------------------------------------

  it("detects a concurrent update via ConcurrencyError rather than silently overwriting (concurrent operations)", async () => {
    const { prisma, repository, unitOfWork } = wire();
    const rr = newReturnRequest();
    await unitOfWork.run((tx) => repository.save(rr, tx));

    const copyA = await repository.findById(rr.id.toString());
    const copyB = await repository.findById(rr.id.toString());
    if (copyA === null || copyB === null) throw new Error("setup failed");
    copyA.approve(ids.generate(), clock.now());
    copyB.reject(ids.generate(), clock.now());

    await unitOfWork.run((tx) => repository.save(copyA, tx));
    await expect(unitOfWork.run((tx) => repository.save(copyB, tx))).rejects.toBeInstanceOf(
      ConcurrencyError,
    );

    const final = await repository.findById(rr.id.toString());
    expect(final?.status.value).toBe("approved"); // B's stale rejection never applied
    await prisma.$disconnect();
  });

  it("rejects true concurrent writes to the same ReturnRequest under real simultaneous transactions", async () => {
    const { prisma, repository, unitOfWork } = wire();
    const rr = newReturnRequest();
    await unitOfWork.run((tx) => repository.save(rr, tx));

    const copyA = await repository.findById(rr.id.toString());
    const copyB = await repository.findById(rr.id.toString());
    if (copyA === null || copyB === null) throw new Error("setup failed");
    copyA.approve(ids.generate(), clock.now());
    copyB.reject(ids.generate(), clock.now());

    const results = await Promise.allSettled([
      unitOfWork.run((tx) => repository.save(copyA, tx)),
      unitOfWork.run((tx) => repository.save(copyB, tx)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    await prisma.$disconnect();
  });

  // --- Idempotency ------------------------------------------------------------------------------

  it("is idempotent recording the same warehouse callback twice at the domain layer (idempotency)", async () => {
    const { prisma, repository, unitOfWork } = wire();
    const rr = newReturnRequest();
    await unitOfWork.run((tx) => repository.save(rr, tx));

    let loaded = (await repository.findById(rr.id.toString()))!;
    loaded.inspectItem("dup-item-ref", true, clock.now());
    await unitOfWork.run((tx) => repository.save(loaded, tx));
    const attemptsAfterFirst = (await repository.findById(rr.id.toString()))!.attempts.length;

    // Re-inspecting the same itemRef is documented as a no-op (no new inspection, no new attempt).
    loaded = (await repository.findById(rr.id.toString()))!;
    loaded.inspectItem("dup-item-ref", true, clock.now());
    await unitOfWork.run((tx) => repository.save(loaded, tx));
    const attemptsAfterSecond = (await repository.findById(rr.id.toString()))!.attempts.length;

    expect(attemptsAfterSecond).toBe(attemptsAfterFirst);
    await prisma.$disconnect();
  });
});
