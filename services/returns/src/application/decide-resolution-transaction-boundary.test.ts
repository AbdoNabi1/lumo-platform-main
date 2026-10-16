import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { ProductRef, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ReturnRequest } from "../domain/return-request";
import { ReturnItem } from "../domain/value-objects/return-item";
import { ReturnReason } from "../domain/value-objects/return-reason";
import type { ReturnRequestRepository } from "../domain/return-request-repository";
import { AcceptItems, DecideResolution, InspectItems } from "./return-lifecycle.use-cases";
import type { PaymentsPort } from "./ports";
import { InMemoryInventoryAdapter } from "../infrastructure/in-memory-port-adapters";

/**
 * Phase A.13.1 — Returns refund transaction-boundary closure.
 *
 * Task 2/12: proves (deterministically, via instrumentation — no timing/sleep assumptions) that
 * `DecideResolution`'s own Prisma-transaction-equivalent is fully closed BEFORE
 * `PaymentsPort.requestRefund` — and therefore the live PSP call it triggers — ever runs.
 *
 * `TrackingUnitOfWork.openCount` stands in for "a live DB transaction is held", same convention as
 * Payments' own `create-intent-transaction-boundary.test.ts` (Phase A.13). Ran against the
 * pre-fix implementation (the call inside `unitOfWork.run(...)`), the "EXPLOIT" test below fails:
 * `openCountAtCall` is `1`, not `0`. This file is evidence that it now passes.
 */
class TrackingUnitOfWork implements TransactionalUnitOfWork<unknown> {
  openCount = 0;
  maxObservedOpenCount = 0;
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    this.openCount += 1;
    this.maxObservedOpenCount = Math.max(this.maxObservedOpenCount, this.openCount);
    try {
      return await work(undefined);
    } finally {
      this.openCount -= 1;
    }
  }
}

/** Records every call plus the Returns-side transaction openCount observed at call time. */
class RecordingPaymentsPort implements PaymentsPort {
  readonly calls: Array<{
    orderRef: string;
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
    openCountAtCall: number;
  }> = [];
  constructor(
    private readonly uow: TrackingUnitOfWork,
    private readonly onCall?: () => Promise<void> | void,
  ) {}

  async requestRefund(
    orderRef: string,
    amountMinor: number,
    currency: string,
    idempotencyKey: string,
  ): Promise<void> {
    this.calls.push({
      orderRef,
      amountMinor,
      currency,
      idempotencyKey,
      openCountAtCall: this.uow.openCount,
    });
    await this.onCall?.();
  }
}

class FailingPaymentsPort implements PaymentsPort {
  readonly calls: Array<{ idempotencyKey: string; openCountAtCall: number }> = [];
  constructor(private readonly uow: TrackingUnitOfWork) {}

  async requestRefund(
    _orderRef: string,
    _amountMinor: number,
    _currency: string,
    idempotencyKey: string,
  ): Promise<void> {
    this.calls.push({ idempotencyKey, openCountAtCall: this.uow.openCount });
    throw new Error("simulated PSP refund failure");
  }
}

class FakeReturnRequestRepository implements ReturnRequestRepository {
  private readonly store = new Map<string, ReturnRequest>();

  async save(returnRequest: ReturnRequest): Promise<void> {
    this.store.set(returnRequest.id.toString(), returnRequest);
    returnRequest.pullDomainEvents();
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

const clock: Clock = { now: () => new Date("2026-08-12T00:00:00.000Z") };

function idGenerator(): IdGenerator {
  let n = 0;
  return { generate: () => `id-${(n += 1)}` };
}

/** Builds a return request already at `items_accepted` — the only status `decideResolution` accepts from. */
async function buildAcceptedReturn(
  returns: ReturnRequestRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
): Promise<string> {
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

  const deps = { returns, unitOfWork, idGenerator: ids, clock };

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

describe("Task 2/12 — exploit + fix proof: PaymentsPort.requestRefund must run with zero Returns transactions open", () => {
  it("EXPLOIT (fails pre-fix, passes post-fix): openCountAtCall is 0 — the Returns transaction committed before the refund request was ever made", async () => {
    const returns = new FakeReturnRequestRepository();
    const uow = new TrackingUnitOfWork();
    const returnId = await buildAcceptedReturn(returns, uow);
    const paymentsPort = new RecordingPaymentsPort(uow);
    const decideResolution = new DecideResolution({
      returns,
      unitOfWork: uow,
      idGenerator: idGenerator(),
      clock,
      paymentsPort,
    });

    const result = await decideResolution.execute({
      tenantId: "tenant-a",
      returnId,
      outcome: "refund",
      amountMinor: 500,
      currency: "USD",
    });

    expect(result.ok).toBe(true);
    expect(paymentsPort.calls).toHaveLength(1);
    expect(paymentsPort.calls[0]?.openCountAtCall).toBe(0);
  });

  it("the resolution decision is durably persisted before the refund request resolves (not merely before it starts)", async () => {
    const returns = new FakeReturnRequestRepository();
    const uow = new TrackingUnitOfWork();
    const returnId = await buildAcceptedReturn(returns, uow);
    let statusDuringPspCall: string | undefined;
    const paymentsPort = new RecordingPaymentsPort(uow, async () => {
      const duringCall = await returns.findById(returnId);
      statusDuringPspCall = duringCall?.status.value;
    });
    const decideResolution = new DecideResolution({
      returns,
      unitOfWork: uow,
      idGenerator: idGenerator(),
      clock,
      paymentsPort,
    });

    await decideResolution.execute({
      tenantId: "tenant-a",
      returnId,
      outcome: "refund",
      amountMinor: 500,
      currency: "USD",
    });

    expect(statusDuringPspCall).toBe("refund_requested");
  });

  it("ordering trace — BEGIN reservation / COMMIT / PSP CALL — matches the required Phase A / Phase B split", async () => {
    const returns = new FakeReturnRequestRepository();
    const uow = new TrackingUnitOfWork();
    const returnId = await buildAcceptedReturn(returns, uow);
    const trace: string[] = [];
    const tracingUow: TransactionalUnitOfWork<unknown> = {
      run: async (work) => {
        trace.push("BEGIN");
        try {
          return await work(undefined);
        } finally {
          trace.push("COMMIT");
        }
      },
    };
    const paymentsPort: PaymentsPort = {
      requestRefund: async () => {
        trace.push("PSP CALL");
      },
    };
    const decideResolution = new DecideResolution({
      returns,
      unitOfWork: tracingUow,
      idGenerator: idGenerator(),
      clock,
      paymentsPort,
    });

    await decideResolution.execute({
      tenantId: "tenant-a",
      returnId,
      outcome: "refund",
      amountMinor: 500,
      currency: "USD",
    });

    expect(trace).toEqual(["BEGIN", "COMMIT", "PSP CALL"]);
  });

  it("non-refund outcomes (replacement/repair) are unaffected — single transaction, unchanged shape", async () => {
    const returns = new FakeReturnRequestRepository();
    const uow = new TrackingUnitOfWork();
    const returnId = await buildAcceptedReturn(returns, uow);
    const paymentsPort: PaymentsPort = {
      requestRefund: async () => {
        throw new Error("must never be called for a replacement outcome");
      },
    };
    const decideResolution = new DecideResolution({
      returns,
      unitOfWork: uow,
      idGenerator: idGenerator(),
      clock,
      paymentsPort,
    });

    const result = await decideResolution.execute({
      tenantId: "tenant-a",
      returnId,
      outcome: "replacement",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("replacement_requested");
  });
});

describe("Task 9 — PSP failure recovery", () => {
  it("reservation (resolution decision) stays committed after a PSP failure; execute() still rejects; no notify fires", async () => {
    const returns = new FakeReturnRequestRepository();
    const uow = new TrackingUnitOfWork();
    const returnId = await buildAcceptedReturn(returns, uow);
    const paymentsPort = new FailingPaymentsPort(uow);
    const notifyCalls: string[] = [];
    const decideResolution = new DecideResolution({
      returns,
      unitOfWork: uow,
      idGenerator: idGenerator(),
      clock,
      paymentsPort,
      notifications: {
        notify: async (_orderRef, status) => {
          notifyCalls.push(status);
        },
      },
    });

    await expect(
      decideResolution.execute({
        tenantId: "tenant-a",
        returnId,
        outcome: "refund",
        amountMinor: 500,
        currency: "USD",
      }),
    ).rejects.toThrow(/simulated PSP refund failure/);

    // Crash-window analysis (Task 10): the reservation committed in its own transaction (Phase A)
    // before the PSP call ran, so a PSP failure — unlike the pre-fix single-transaction shape —
    // does NOT roll it back. Payments' own `settle()` (inside `requestRefund`, unchanged) is what
    // separately records the failed `Refund` row and frees `remaining()` capacity for a retry.
    const persisted = await returns.findById(returnId);
    expect(persisted?.status.value).toBe("refund_requested");

    // Matches pre-fix observable behavior: notifyBestEffort never ran because the throw happened
    // before reaching it (previously because the whole transaction aborted; now because `execute()`
    // still propagates the PSP error before its own post-refund notify call).
    expect(notifyCalls).toHaveLength(0);

    expect(paymentsPort.calls).toHaveLength(1);
    expect(paymentsPort.calls[0]?.openCountAtCall).toBe(0);
    expect(paymentsPort.calls[0]?.idempotencyKey).toBe(`${returnId}:refund`);
  });
});

describe("Task 6/7 — resolution semantics and idempotency key preserved", () => {
  it("zero-amount refund still reaches PaymentsPort with amountMinor 0 and the stable <returnId>:refund idempotency key", async () => {
    const returns = new FakeReturnRequestRepository();
    const uow = new TrackingUnitOfWork();
    const returnId = await buildAcceptedReturn(returns, uow);
    const paymentsPort = new RecordingPaymentsPort(uow);
    const decideResolution = new DecideResolution({
      returns,
      unitOfWork: uow,
      idGenerator: idGenerator(),
      clock,
      paymentsPort,
    });

    const result = await decideResolution.execute({
      tenantId: "tenant-a",
      returnId,
      outcome: "refund",
      amountMinor: 0,
      currency: "USD",
    });

    expect(result.ok).toBe(true);
    expect(paymentsPort.calls).toHaveLength(1);
    expect(paymentsPort.calls[0]?.amountMinor).toBe(0);
    expect(paymentsPort.calls[0]?.idempotencyKey).toBe(`${returnId}:refund`);
  });

  it("a second DecideResolution call against an already-refund_requested return is rejected at the state machine, before ever reaching PaymentsPort again", async () => {
    const returns = new FakeReturnRequestRepository();
    const uow = new TrackingUnitOfWork();
    const returnId = await buildAcceptedReturn(returns, uow);
    const paymentsPort = new RecordingPaymentsPort(uow);
    const decideResolution = new DecideResolution({
      returns,
      unitOfWork: uow,
      idGenerator: idGenerator(),
      clock,
      paymentsPort,
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
    expect(second.ok).toBe(false);
    expect(paymentsPort.calls).toHaveLength(1);
  });
});
