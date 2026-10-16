import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { ProductRef, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ConcurrencyError } from "@platform/utils";
import { ReturnRequest } from "./domain/return-request";
import type { ReturnRequestRepository } from "./domain/return-request-repository";
import { ReturnItem } from "./domain/value-objects/return-item";
import { ReturnReason } from "./domain/value-objects/return-reason";
import { ReceivePackage, type ReceivePackageDeps } from "./application/return-lifecycle.use-cases";
import type { ShippingPort } from "./application/ports";
import {
  ReturnRequestMapper,
  type ReturnRequestRow,
  type AttemptRow,
} from "./infrastructure/return-request.mapper";

/**
 * Phase A.18 — dedup-store transaction-boundary hardening for Returns `ReceivePackage`.
 *
 * Pre-fix, `ProcessedWarehouseCallbackStore.hasProcessed`/`markProcessed()` took no `tx` parameter,
 * so — exactly as A.17 §14 documented but deliberately did not fix — they did not commit atomically
 * with `ReturnRequestRepository.save()`. GREEN evidence below proves the fix (Option B, Task 7:
 * dedup folded into `returnRequest.attempts`, the same tx-scoped read/write already used for the
 * rest of the aggregate) closes both failure modes. `ReceivePackageDeps` no longer HAS a
 * `processedWarehouseCallbacks` field at all — there is no separate store left to desync.
 */

class PostgresLikeReturnRequestRepository implements ReturnRequestRepository {
  private readonly rows = new Map<string, { row: ReturnRequestRow; attempts: AttemptRow[] }>();
  private readonly tenantId = "tenant-local";

  seed(returnRequest: ReturnRequest): void {
    this.write(returnRequest, 1);
  }

  /** Test-only: snapshots/restores the whole table — models a real transaction's all-or-nothing rollback. */
  snapshot(): Map<string, { row: ReturnRequestRow; attempts: AttemptRow[] }> {
    const copy = new Map<string, { row: ReturnRequestRow; attempts: AttemptRow[] }>();
    for (const [key, value] of this.rows)
      copy.set(key, { row: value.row, attempts: [...value.attempts] });
    return copy;
  }

  restore(snapshot: Map<string, { row: ReturnRequestRow; attempts: AttemptRow[] }>): void {
    this.rows.clear();
    for (const [key, value] of snapshot) this.rows.set(key, value);
  }

  async save(returnRequest: ReturnRequest): Promise<void> {
    const id = returnRequest.id.toString();
    const existing = this.rows.get(id);
    if (existing === undefined) {
      this.write(returnRequest, 1);
      return;
    }
    if (existing.row.version !== returnRequest.version) {
      throw new ConcurrencyError(
        `ReturnRequest ${id} was modified concurrently (expected version ${returnRequest.version})`,
      );
    }
    this.write(returnRequest, existing.row.version + 1);
  }

  async findById(id: string): Promise<ReturnRequest | null> {
    const entry = this.rows.get(id);
    if (entry === undefined) return null;
    return ReturnRequestMapper.toDomain(entry.row, entry.attempts);
  }

  async findByOrderRef(orderRef: string): Promise<ReturnRequest | null> {
    for (const entry of this.rows.values()) {
      const returnRequest = ReturnRequestMapper.toDomain(entry.row, entry.attempts);
      if (returnRequest.orderRef === orderRef) return returnRequest;
    }
    return null;
  }

  private write(returnRequest: ReturnRequest, version: number): void {
    const row = { ...ReturnRequestMapper.toRow(returnRequest, this.tenantId), version };
    const newAttempts = ReturnRequestMapper.toAttemptRows(returnRequest, this.tenantId);
    const existing = this.rows.get(returnRequest.id.toString());
    const existingIds = new Set((existing?.attempts ?? []).map((a) => a.id));
    const attempts = [
      ...(existing?.attempts ?? []),
      ...newAttempts.filter((a) => !existingIds.has(a.id)),
    ];
    this.rows.set(returnRequest.id.toString(), {
      row: row as unknown as ReturnRequestRow,
      attempts,
    });
    returnRequest.pullDomainEvents();
  }
}

class TrackingUnitOfWork implements TransactionalUnitOfWork<unknown> {
  openCount = 0;
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    this.openCount += 1;
    try {
      return await work(undefined);
    } finally {
      this.openCount -= 1;
    }
  }
}

/** Same crash-simulation shape as Automation's equivalent test — see that file's doc comment. */
class FlakyCommitUnitOfWork implements TransactionalUnitOfWork<unknown> {
  constructor(
    private readonly repo: PostgresLikeReturnRequestRepository,
    private readonly failCommit: () => boolean,
  ) {}
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    const snapshot = this.repo.snapshot();
    const result = await work(undefined);
    if (this.failCommit()) {
      this.repo.restore(snapshot);
      throw new Error("simulated crash: transaction failed to commit after the callback returned");
    }
    return result;
  }
}

class RecordingShippingAdapter implements ShippingPort {
  readonly calls: string[] = [];
  async verifyReturnShipment(orderRef: string): Promise<boolean> {
    this.calls.push(orderRef);
    return true;
  }
}

const clock: Clock = { now: () => new Date("2026-08-13T00:00:00.000Z") };

function sequentialIds(prefix: string): IdGenerator {
  let n = 0;
  return { generate: () => `${prefix}-${(n += 1)}` };
}

function productRef(value: string): ProductRef {
  const result = ProductRef.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

/** Seeds a return already at `rma_generated` — the only status `ReceivePackage` accepts from. */
function seedRmaGeneratedReturn(
  repo: PostgresLikeReturnRequestRepository,
  id: string,
  orderRef: string,
  ids: IdGenerator,
): void {
  const reason = ReturnReason.create("defective");
  if (!reason.ok) throw new Error("invalid fixture");
  const item = ReturnItem.create(
    UniqueEntityId.from("order-item-1"),
    "order-item-1",
    productRef("product-1"),
    1,
    reason.value,
  );
  const returnRequest = ReturnRequest.create(UniqueEntityId.from(id), orderRef, [item]);
  returnRequest.approve(ids.generate(), clock.now());
  returnRequest.generateRma("RMA-1", ids.generate(), clock.now());
  returnRequest.pullDomainEvents();
  repo.seed(returnRequest);
}

function buildDeps(
  repo: PostgresLikeReturnRequestRepository,
  uow: TransactionalUnitOfWork<unknown>,
  ids: IdGenerator,
  shippingPort: ShippingPort,
): ReceivePackageDeps {
  return {
    returns: repo,
    unitOfWork: uow,
    idGenerator: ids,
    clock,
    ordersPort: { reportReturnOutcome: async () => {} },
    notifications: { notify: async () => {} },
    shippingPort,
  };
}

describe("Task 5/8 — GREEN: no separate dedup store means no process-restart-loses-dedup window", () => {
  it("a brand-new ReceivePackage instance (simulating a process restart) still correctly detects the prior callback via the durable aggregate alone", async () => {
    const ids = sequentialIds("evt");
    const repo = new PostgresLikeReturnRequestRepository();
    seedRmaGeneratedReturn(repo, "ret-restart", "order-restart", ids);
    const uow = new TrackingUnitOfWork();

    const shipping1 = new RecordingShippingAdapter();
    const deps1 = buildDeps(repo, uow, ids, shipping1);
    const first = await new ReceivePackage(deps1).execute({
      tenantId: "tenant-a",
      returnId: "ret-restart",
      source: "warehouse-1",
      callbackId: "cb-1",
    });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.duplicate).toBe(false);
    expect(shipping1.calls).toHaveLength(1);

    const persisted = await repo.findById("ret-restart");
    expect(persisted?.status.value).toBe("package_received");

    const shipping2 = new RecordingShippingAdapter();
    const deps2 = buildDeps(repo, uow, ids, shipping2);
    const second = await new ReceivePackage(deps2).execute({
      tenantId: "tenant-a",
      returnId: "ret-restart",
      source: "warehouse-1",
      callbackId: "cb-1",
    });

    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.duplicate).toBe(true);
    expect(shipping2.calls).toHaveLength(0);
  });
});

describe("Task 5 — crash recovery: a rolled-back attempt never permanently suppresses the retry", () => {
  it("EXPLOIT would have been (pre-fix shape): a crash between the non-tx markProcessed() write and the transaction's own commit permanently marks the callback processed while the receive is silently lost — GREEN: no such separate write exists anymore", async () => {
    const ids = sequentialIds("evt");
    const repo = new PostgresLikeReturnRequestRepository();
    seedRmaGeneratedReturn(repo, "ret-crash", "order-crash", ids);
    let crashOnNextCommit = true;
    const uow = new FlakyCommitUnitOfWork(repo, () => {
      const should = crashOnNextCommit;
      crashOnNextCommit = false;
      return should;
    });
    const shipping = new RecordingShippingAdapter();
    const deps = buildDeps(repo, uow, ids, shipping);

    await expect(
      new ReceivePackage(deps).execute({
        tenantId: "tenant-a",
        returnId: "ret-crash",
        source: "warehouse-1",
        callbackId: "cb-2",
      }),
    ).rejects.toThrow(/simulated crash/);

    const afterCrash = await repo.findById("ret-crash");
    expect(afterCrash?.status.value).toBe("rma_generated"); // rolled back, never transitioned

    const retry = await new ReceivePackage(deps).execute({
      tenantId: "tenant-a",
      returnId: "ret-crash",
      source: "warehouse-1",
      callbackId: "cb-2",
    });

    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.value.duplicate).toBe(false);
    expect(shipping.calls).toHaveLength(2); // 1 doomed + 1 real retry — never permanently suppressed
    const afterRetry = await repo.findById("ret-crash");
    expect(afterRetry?.status.value).toBe("package_received");
  });
});

describe("Task 5 — Scenario D/E/F: concurrent identical ReceivePackage calls", () => {
  for (const n of [2, 3, 10]) {
    it(`${n} concurrent calls with the SAME (source, callbackId) result in exactly one durable transition and never an unhandled ConcurrencyError`, async () => {
      const ids = sequentialIds("evt");
      const repo = new PostgresLikeReturnRequestRepository();
      seedRmaGeneratedReturn(repo, `ret-race-${n}`, `order-race-${n}`, ids);
      const shipping = new RecordingShippingAdapter();
      const uow = new TrackingUnitOfWork();
      const deps = buildDeps(repo, uow, ids, shipping);
      const useCase = new ReceivePackage(deps);

      const outcomes = await Promise.all(
        Array.from({ length: n }, () =>
          useCase.execute({
            tenantId: "tenant-a",
            returnId: `ret-race-${n}`,
            source: "warehouse-1",
            callbackId: "cb-race",
          }),
        ),
      );

      for (const outcome of outcomes) {
        expect(outcome.ok).toBe(true);
      }
      const persisted = await repo.findById(`ret-race-${n}`);
      expect(persisted?.status.value).toBe("package_received");
      expect(
        persisted?.attempts.filter(
          (a) => a.kind === "warehouse_callback" && a.outcome === "succeeded",
        ),
      ).toHaveLength(1);
    });
  }
});

describe("Task 5/6 — regression: existing single-attempt behavior is unchanged", () => {
  it("a fresh callback verifies shipment once and transitions to package_received", async () => {
    const ids = sequentialIds("evt");
    const repo = new PostgresLikeReturnRequestRepository();
    seedRmaGeneratedReturn(repo, "ret-basic", "order-basic", ids);
    const shipping = new RecordingShippingAdapter();
    const uow = new TrackingUnitOfWork();
    const deps = buildDeps(repo, uow, ids, shipping);

    const result = await new ReceivePackage(deps).execute({
      tenantId: "tenant-a",
      returnId: "ret-basic",
      source: "warehouse-1",
      callbackId: "cb-basic",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.duplicate).toBe(false);
      expect(result.value.status).toBe("package_received");
    }
    expect(shipping.calls).toHaveLength(1);
  });

  it("retrying the exact same (source, callbackId) after a genuine success does not re-verify shipment", async () => {
    const ids = sequentialIds("evt");
    const repo = new PostgresLikeReturnRequestRepository();
    seedRmaGeneratedReturn(repo, "ret-resume", "order-resume", ids);
    const shipping = new RecordingShippingAdapter();
    const uow = new TrackingUnitOfWork();
    const deps = buildDeps(repo, uow, ids, shipping);
    const useCase = new ReceivePackage(deps);

    const first = await useCase.execute({
      tenantId: "tenant-a",
      returnId: "ret-resume",
      source: "warehouse-1",
      callbackId: "cb-resume",
    });
    expect(first.ok).toBe(true);
    const second = await useCase.execute({
      tenantId: "tenant-a",
      returnId: "ret-resume",
      source: "warehouse-1",
      callbackId: "cb-resume",
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.duplicate).toBe(true);
    expect(shipping.calls).toHaveLength(1);
  });

  it("the SAME callbackId from a DIFFERENT source is never treated as a duplicate of the first", async () => {
    const ids = sequentialIds("evt");
    const repo = new PostgresLikeReturnRequestRepository();
    seedRmaGeneratedReturn(repo, "ret-diffsrc", "order-diffsrc", ids);
    const shipping = new RecordingShippingAdapter();
    const uow = new TrackingUnitOfWork();
    const deps = buildDeps(repo, uow, ids, shipping);
    const useCase = new ReceivePackage(deps);

    const first = await useCase.execute({
      tenantId: "tenant-a",
      returnId: "ret-diffsrc",
      source: "warehouse-1",
      callbackId: "cb-shared",
    });
    expect(first.ok).toBe(true);

    // The return is now package_received — a second call, even with the same callbackId from a
    // DIFFERENT warehouse, is legitimately a distinct callback but the state machine has no
    // self-loop from package_received, so it must be rejected, not silently accepted OR
    // incorrectly reported as a duplicate of the first.
    const second = await useCase.execute({
      tenantId: "tenant-a",
      returnId: "ret-diffsrc",
      source: "warehouse-2",
      callbackId: "cb-shared",
    });
    expect(second.ok).toBe(false);
    expect(shipping.calls).toHaveLength(2);
  });

  it("a return not found returns a clean NOT_FOUND, never touches Shipping", async () => {
    const ids = sequentialIds("evt");
    const repo = new PostgresLikeReturnRequestRepository();
    const shipping = new RecordingShippingAdapter();
    const uow = new TrackingUnitOfWork();
    const deps = buildDeps(repo, uow, ids, shipping);

    const result = await new ReceivePackage(deps).execute({
      tenantId: "tenant-a",
      returnId: "does-not-exist",
      source: "warehouse-1",
      callbackId: "cb-x",
    });

    expect(result.ok).toBe(false);
    expect(shipping.calls).toHaveLength(0);
  });

  it("an unverified shipment is rejected without transitioning or recording an attempt", async () => {
    const ids = sequentialIds("evt");
    const repo = new PostgresLikeReturnRequestRepository();
    seedRmaGeneratedReturn(repo, "ret-unverified", "order-unverified", ids);
    const uow = new TrackingUnitOfWork();
    const deps = buildDeps(repo, uow, ids, { verifyReturnShipment: async () => false });

    const result = await new ReceivePackage(deps).execute({
      tenantId: "tenant-a",
      returnId: "ret-unverified",
      source: "warehouse-1",
      callbackId: "cb-unverified",
    });

    expect(result.ok).toBe(false);
    const persisted = await repo.findById("ret-unverified");
    expect(persisted?.status.value).toBe("rma_generated");
    expect(persisted?.attempts.filter((a) => a.kind === "warehouse_callback")).toHaveLength(0);
  });
});
