import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { ProductRef, UniqueEntityId } from "@platform/domain";
import { ReturnRequest } from "../domain/return-request";
import { ReturnItem } from "../domain/value-objects/return-item";
import { ReturnReason } from "../domain/value-objects/return-reason";
import type { ReturnRequestRepository } from "../domain/return-request-repository";
import { AcceptItems, DecideResolution, InspectItems } from "./return-lifecycle.use-cases";
import type { PaymentsPort, RefundVerificationPort } from "./ports";
import { InMemoryInventoryAdapter } from "../infrastructure/in-memory-port-adapters";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";

/**
 * Phase A.2 — Task 4 exploit proof + Task 6 regression: exercises `DecideResolution` directly
 * (bypassing `wireReturns`, whose `paymentsPort` is hardcoded to an unconditional no-op stub — see
 * PHASE_A2_REFUND_SECURITY_CLOSURE_AUDIT.md, Task 1) with a real spy `PaymentsPort`, so the claim
 * "an unbounded refund amount reaches PaymentsPort" is proven at the actual call boundary, not
 * merely inferred from the return's own resulting status.
 */

const clock: Clock = { now: () => new Date("2026-08-10T00:00:00.000Z") };

function idGenerator(): IdGenerator {
  let n = 0;
  return { generate: () => `id-${(n += 1)}` };
}

class FakeReturnRequestRepository implements ReturnRequestRepository {
  private readonly store = new Map<string, ReturnRequest>();

  async save(returnRequest: ReturnRequest): Promise<void> {
    this.store.set(returnRequest.id.toString(), returnRequest);
    returnRequest.pullDomainEvents(); // drain, unused by these tests
  }

  async findById(id: string): Promise<ReturnRequest | null> {
    return this.store.get(id) ?? null;
  }

  async findByOrderRef(orderRef: string): Promise<ReturnRequest | null> {
    for (const returnRequest of this.store.values()) {
      if (returnRequest.orderRef === orderRef) return returnRequest;
    }
    return null;
  }
}

class SpyPaymentsPort implements PaymentsPort {
  readonly calls: Array<{
    orderRef: string;
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
  }> = [];

  async requestRefund(
    orderRef: string,
    amountMinor: number,
    currency: string,
    idempotencyKey: string,
  ): Promise<void> {
    this.calls.push({ orderRef, amountMinor, currency, idempotencyKey });
  }
}

/** Builds a return request already at `items_accepted` — the only status `decideResolution` accepts from. */
async function buildAcceptedReturn(returns: ReturnRequestRepository): Promise<string> {
  const ids = idGenerator();
  const reason = ReturnReason.create("defective");
  const productRef = ProductRef.create("product-1");
  if (!reason.ok || !productRef.ok) throw new Error("invalid fixture");
  const item = ReturnItem.create(
    UniqueEntityId.from("order-item-1"),
    "order-item-1",
    productRef.value,
    1,
    reason.value,
  );
  const returnRequest = ReturnRequest.create(UniqueEntityId.from(ids.generate()), "order-1", [
    item,
  ]);
  returnRequest.pullDomainEvents();
  const returnId = returnRequest.id.toString();
  await returns.save(returnRequest, "tenant-a");

  const uow = new InMemoryUnitOfWork();
  const deps = { returns, unitOfWork: uow, idGenerator: ids, clock };

  const approve = returnRequest;
  approve.approve(ids.generate(), clock.now());
  approve.pullDomainEvents();
  await returns.save(approve, "tenant-a");

  approve.generateRma("RMA-1", ids.generate(), clock.now());
  approve.pullDomainEvents();
  await returns.save(approve, "tenant-a");

  approve.recordWarehouseCallback(clock.now(), "cb-1");
  approve.receivePackage(ids.generate(), clock.now());
  approve.pullDomainEvents();
  await returns.save(approve, "tenant-a");

  const inspectItems = new InspectItems(deps);
  const inspected = await inspectItems.execute({
    tenantId: "tenant-a",
    returnId,
    itemRef: "order-item-1",
    passed: true,
  });
  if (!inspected.ok) throw new Error(`inspection failed: ${JSON.stringify(inspected.error)}`);

  approve.transition("inspection_completed", ids.generate(), clock.now());
  approve.pullDomainEvents();
  await returns.save(approve, "tenant-a");

  const acceptItems = new AcceptItems({ ...deps, inventoryPort: new InMemoryInventoryAdapter() });
  const accepted = await acceptItems.execute({
    tenantId: "tenant-a",
    returnId,
    items: [{ orderItemRef: "order-item-1", disposition: "restock" }],
  });
  if (!accepted.ok) throw new Error(`accept failed: ${JSON.stringify(accepted.error)}`);

  return returnId;
}

/** A fake `RefundVerificationPort` computing the ceiling exactly the way `PrismaRefundVerificationAdapter` does: captured=1000, alreadyRefunded=200 ⇒ remaining=800. */
const CAPTURED_1000_REFUNDED_200: RefundVerificationPort = {
  isRefundable: async (_orderRef, amountMinor, currency) =>
    amountMinor <= 800 && currency === "USD",
};

describe("DecideResolution — F-04 refund amount", () => {
  it("Task 4 exploit proof, UNWIRED (no refundVerification): captured=1000, alreadyRefunded=200, requested=5000 REACHES PaymentsPort unbounded", async () => {
    const returns = new FakeReturnRequestRepository();
    const returnId = await buildAcceptedReturn(returns);
    const paymentsPort = new SpyPaymentsPort();
    const uow = new InMemoryUnitOfWork();
    const decideResolution = new DecideResolution({
      returns,
      unitOfWork: uow,
      idGenerator: idGenerator(),
      clock,
      paymentsPort,
      // refundVerification intentionally omitted — this repo's current default composition.
    });

    const result = await decideResolution.execute({
      tenantId: "tenant-a",
      returnId,
      outcome: "refund",
      amountMinor: 5000,
      currency: "USD",
    });

    expect(result.ok).toBe(true);
    // PROOF: the unbounded 5000 reached PaymentsPort.requestRefund exactly once, verbatim.
    expect(paymentsPort.calls).toHaveLength(1);
    expect(paymentsPort.calls[0]?.amountMinor).toBe(5000);
    expect(paymentsPort.calls[0]?.orderRef).toBe("order-1");
  });

  it("Task 6 regression, WIRED (refundVerification simulating captured=1000/refunded=200): requested=5000 is rejected and NEVER reaches PaymentsPort", async () => {
    const returns = new FakeReturnRequestRepository();
    const returnId = await buildAcceptedReturn(returns);
    const paymentsPort = new SpyPaymentsPort();
    const uow = new InMemoryUnitOfWork();
    const decideResolution = new DecideResolution({
      returns,
      unitOfWork: uow,
      idGenerator: idGenerator(),
      clock,
      paymentsPort,
      refundVerification: CAPTURED_1000_REFUNDED_200,
    });

    const result = await decideResolution.execute({
      tenantId: "tenant-a",
      returnId,
      outcome: "refund",
      amountMinor: 5000,
      currency: "USD",
    });

    expect(result.ok).toBe(false);
    // PROOF: PaymentsPort was never called — the ceiling check short-circuits before the transition
    // and before the refund request.
    expect(paymentsPort.calls).toHaveLength(0);
  });

  it("WIRED: requested=800 (exactly the remaining ceiling) succeeds and reaches PaymentsPort with 800", async () => {
    const returns = new FakeReturnRequestRepository();
    const returnId = await buildAcceptedReturn(returns);
    const paymentsPort = new SpyPaymentsPort();
    const uow = new InMemoryUnitOfWork();
    const decideResolution = new DecideResolution({
      returns,
      unitOfWork: uow,
      idGenerator: idGenerator(),
      clock,
      paymentsPort,
      refundVerification: CAPTURED_1000_REFUNDED_200,
    });

    const result = await decideResolution.execute({
      tenantId: "tenant-a",
      returnId,
      outcome: "refund",
      amountMinor: 800,
      currency: "USD",
    });

    expect(result.ok).toBe(true);
    expect(paymentsPort.calls).toHaveLength(1);
    expect(paymentsPort.calls[0]?.amountMinor).toBe(800);
  });

  it("WIRED: requested=801 (one cent over the remaining ceiling) is rejected", async () => {
    const returns = new FakeReturnRequestRepository();
    const returnId = await buildAcceptedReturn(returns);
    const paymentsPort = new SpyPaymentsPort();
    const uow = new InMemoryUnitOfWork();
    const decideResolution = new DecideResolution({
      returns,
      unitOfWork: uow,
      idGenerator: idGenerator(),
      clock,
      paymentsPort,
      refundVerification: CAPTURED_1000_REFUNDED_200,
    });

    const result = await decideResolution.execute({
      tenantId: "tenant-a",
      returnId,
      outcome: "refund",
      amountMinor: 801,
      currency: "USD",
    });

    expect(result.ok).toBe(false);
    expect(paymentsPort.calls).toHaveLength(0);
  });

  it("attempting to decide a resolution twice on the same return is blocked at the state machine (duplicate-refund guard)", async () => {
    const returns = new FakeReturnRequestRepository();
    const returnId = await buildAcceptedReturn(returns);
    const paymentsPort = new SpyPaymentsPort();
    const uow = new InMemoryUnitOfWork();
    const decideResolution = new DecideResolution({
      returns,
      unitOfWork: uow,
      idGenerator: idGenerator(),
      clock,
      paymentsPort,
      refundVerification: CAPTURED_1000_REFUNDED_200,
    });

    const first = await decideResolution.execute({
      tenantId: "tenant-a",
      returnId,
      outcome: "refund",
      amountMinor: 300,
      currency: "USD",
    });
    expect(first.ok).toBe(true);

    const second = await decideResolution.execute({
      tenantId: "tenant-a",
      returnId,
      outcome: "refund",
      amountMinor: 300,
      currency: "USD",
    });
    expect(second.ok).toBe(false); // "refund_requested" only transitions to "closed" — re-entry rejected

    expect(paymentsPort.calls).toHaveLength(1); // the second attempt never reached PaymentsPort
  });
});
