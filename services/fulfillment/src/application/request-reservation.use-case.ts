import type { UseCase } from "@platform/application";
import { isDomainError } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ConcurrencyError, type DomainError, NotFoundError } from "@platform/utils";
import type { FulfillmentOrderRepository } from "../domain/fulfillment-order-repository";
import type { FulfillmentOrderIdInput } from "./fulfillment-lifecycle.use-cases";
import { notifyBestEffort, type FulfillmentLifecycleDeps } from "./fulfillment-lifecycle.use-cases";
import type { FulfillmentOrderStatusOutput } from "./create-fulfillment.use-case";
import type { InventoryPort, ReservationItem, ReservationResult } from "./ports";

export interface RequestReservationDeps extends FulfillmentLifecycleDeps {
  readonly fulfillmentOrders: FulfillmentOrderRepository;
  readonly inventoryPort: InventoryPort;
}

/**
 * Bounded retry on optimistic-lock conflicts only (Phase A.15, reusing the shape Payments'
 * `withConcurrencyRetry` established in Phase A.4/A.8 — duplicated locally per this codebase's
 * established convention, not shared across packages) — `PrismaFulfillmentOrderRepository.save`
 * throws `ConcurrencyError` when a concurrent writer already advanced the row's `version`; that is
 * expected/recoverable (two racing reservation requests for the same order), so the whole
 * read-transition-write attempt is retried from scratch against the now-current row. Any other
 * error (including a Result-channel domain rejection, which is returned not thrown) propagates
 * immediately.
 */
async function withConcurrencyRetry<T>(maxAttempts: number, attempt: () => Promise<T>): Promise<T> {
  for (let i = 1; i <= maxAttempts; i += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof ConcurrencyError) || i === maxAttempts) {
        throw error;
      }
    }
  }
  throw new Error("unreachable");
}

interface ReservationOutcome {
  readonly status: string;
  readonly orderRef: string;
  readonly items: readonly ReservationItem[];
  /**
   * Whether THIS call should proceed to call `InventoryPort.reserve()`. False for an order already
   * fully settled (`confirmed`) and for a caller whose OWN attempt only observes
   * `reservation_requested` because it just lost the optimistic-lock race to another concurrent
   * caller — see the class doc's "Concurrency" section.
   */
  readonly proceedToPort: boolean;
}

/**
 * Requests a stock reservation from Inventory (`InventoryPort.reserve`) — Fulfillment reserves
 * nothing itself. Confirms or fails the reservation step based on the port's synchronous outcome.
 *
 * Phase A.15 (Task 1, cross-context transaction-boundary remediation — A.14 §11): `InventoryPort.
 * reserve()` used to run INSIDE the same `unitOfWork.run` transaction that read (and would
 * eventually persist) the fulfillment order, holding a DB connection open for the full duration of a
 * cross-context call — the same long-transaction anti-pattern A.4/A.8/A.13.1 already closed for
 * Payments/Returns. Unlike `CreateShipment` (no durable intermediate status to reserve before its
 * own external call), `FulfillmentOrder`'s transition table already has exactly that: `created ->
 * reservation_requested -> confirmed/failed` (`fulfillment-status.ts`) — the prior code computed
 * `reservation_requested` in memory but never durably committed it before calling Inventory. This
 * fix makes that write durable and commits it BEFORE `InventoryPort.reserve()` is ever called,
 * mirroring `CapturePaymentLifecycle`'s reserve/PSP-call/settle split (Phase A.8):
 *   1. `reserve()` — durably transitions the order to `reservation_requested`
 *      (`FulfillmentOrder.requestReservation`) in its own committed transaction, BEFORE Inventory is
 *      ever called. An order already `confirmed` short-circuits here (`proceedToPort: false`) —
 *      idempotent-resume protection mirroring Capture's `alreadyCaptured` guard. Any other status
 *      (`created`, `failed`, or anything the transition table would reject) falls through to
 *      attempting `requestReservation()`, which enforces its own legality exactly as before this fix
 *      (an illegal-transition attempt still returns the same `BusinessRuleError` it always did).
 *   2. The `InventoryPort.reserve()` call itself, deliberately OUTSIDE any open transaction.
 *   3. `settle()` — re-reads, guards against the reservation already being resolved (`confirmed`/
 *      `failed` — a no-op resume, mirroring Capture's Phase A.9 `alreadyCaptured` write+side-effect
 *      guard), applies `confirmReservation()`/`failReservation()` from the port's result, saves,
 *      notifies.
 *
 * Concurrency (duplicate-call protection): `InventoryPort.reserve()`, unlike `PaymentProvider.
 * capture()`, takes NO idempotency key — there is no PSP-side dedup to fall back on, so unlike
 * Capture this fix cannot just let both racers re-present the same call and trust the far side to
 * collapse it. Instead, `reserve()` distinguishes "I just performed the `created`/`failed ->
 * reservation_requested` write myself" from "I found the order ALREADY at `reservation_requested`
 * without having caused it": only the former proceeds to call Inventory. A caller whose own `save()`
 * loses the optimistic-lock race (`ConcurrencyError`, caught by `withConcurrencyRetry`) re-reads on
 * its NEXT attempt and finds `reservation_requested` already committed by the winner — that retry
 * does NOT call Inventory a second time, it simply returns the current (pending) status; the
 * winner's own `execute()` continues on to call Inventory and `settle()` normally. This is provably
 * race-free for the lock-step concurrent case this phase's tests exercise (two callers reading the
 * SAME pre-reservation snapshot, one losing the version check).
 *
 * RESIDUAL RISK (documented, not fixed by this phase): this is NOT a substitute for a real lease or
 * a port-level idempotency key. A caller that arrives late enough to read `reservation_requested` on
 * its OWN FIRST attempt (no `ConcurrencyError` ever raised for it — e.g. a genuinely new request
 * arriving after another process's `reserve()` already committed but before that process's own
 * Inventory call/`settle()` finished) cannot be distinguished from a legitimate crash/failure retry
 * and — by design, so a crash-orphaned `reservation_requested` order is not permanently stuck — DOES
 * proceed to call Inventory again. Closing that residual staggered-arrival window would require a
 * port-level idempotency key (an `InventoryPort.reserve()` signature change) or a real lease, both
 * out of this phase's scope per the brief.
 */
export class RequestReservation implements UseCase<
  FulfillmentOrderIdInput,
  FulfillmentOrderStatusOutput,
  DomainError
> {
  private readonly deps: RequestReservationDeps;
  private static readonly MAX_CONCURRENCY_RETRIES = 5;

  constructor(deps: RequestReservationDeps) {
    this.deps = deps;
  }

  async execute(
    input: FulfillmentOrderIdInput,
  ): Promise<Result<FulfillmentOrderStatusOutput, DomainError>> {
    const reservation = await this.reserve(input.fulfillmentOrderId, input.tenantId);
    if (!reservation.ok) return err(reservation.error);
    const { status, orderRef, items, proceedToPort } = reservation.value;

    if (!proceedToPort) {
      return ok({ fulfillmentOrderId: input.fulfillmentOrderId, status });
    }

    const reservationResult = await this.deps.inventoryPort.reserve(
      orderRef,
      items,
      input.tenantId,
    );

    return this.settle(input.fulfillmentOrderId, input.tenantId, reservationResult);
  }

  private async reserve(
    fulfillmentOrderId: string,
    tenantId: string,
  ): Promise<Result<ReservationOutcome, DomainError>> {
    let attempt = 0;
    return withConcurrencyRetry(RequestReservation.MAX_CONCURRENCY_RETRIES, () => {
      attempt += 1;
      const isFirstAttempt = attempt === 1;
      return this.deps.unitOfWork.run<Result<ReservationOutcome, DomainError>>(async (tx) => {
        const fulfillmentOrder = await this.deps.fulfillmentOrders.findById(
          fulfillmentOrderId,
          tenantId,
          tx,
        );
        if (fulfillmentOrder === null) {
          return err(new NotFoundError("Fulfillment order not found"));
        }

        const items = fulfillmentOrder.items.map((item) => ({
          productRef: item.productRef.value,
          quantity: item.quantity,
        }));

        if (fulfillmentOrder.status.value === "reservation_requested") {
          // Resume: either OUR OWN retry after losing the optimistic-lock race (attempt > 1 — do
          // not call Inventory again, the winner owns it) or a genuinely standalone call finding a
          // durable reservation left by a prior attempt (attempt 1 — a crash/failure retry, safe
          // and necessary to make progress again). See class doc "Concurrency" / "Residual risk".
          return ok({
            status: fulfillmentOrder.status.value,
            orderRef: fulfillmentOrder.orderRef,
            items,
            proceedToPort: isFirstAttempt,
          });
        }
        if (fulfillmentOrder.status.value === "confirmed") {
          // Already fully settled by a prior attempt — idempotent no-op, mirrors Capture's
          // `alreadyCaptured` guard.
          return ok({
            status: fulfillmentOrder.status.value,
            orderRef: fulfillmentOrder.orderRef,
            items,
            proceedToPort: false,
          });
        }

        try {
          fulfillmentOrder.requestReservation(
            this.deps.idGenerator.generate(),
            this.deps.clock.now(),
          );
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }

        await this.deps.fulfillmentOrders.save(fulfillmentOrder, tenantId, tx);
        return ok({
          status: fulfillmentOrder.status.value,
          orderRef: fulfillmentOrder.orderRef,
          items,
          proceedToPort: true,
        });
      });
    });
  }

  private async settle(
    fulfillmentOrderId: string,
    tenantId: string,
    reservationResult: ReservationResult,
  ): Promise<Result<FulfillmentOrderStatusOutput, DomainError>> {
    return withConcurrencyRetry(RequestReservation.MAX_CONCURRENCY_RETRIES, () =>
      this.deps.unitOfWork.run<Result<FulfillmentOrderStatusOutput, DomainError>>(async (tx) => {
        const fulfillmentOrder = await this.deps.fulfillmentOrders.findById(
          fulfillmentOrderId,
          tenantId,
          tx,
        );
        if (fulfillmentOrder === null) {
          return err(new NotFoundError("Fulfillment order not found"));
        }

        // Phase A.15 (mirrors Capture's Phase A.9 `alreadyCaptured` guard): a settle() call for a
        // reservation that is no longer `reservation_requested` (a losing concurrency retry
        // resuming after a racing settle() already won, or a plain replay) must be a pure no-op —
        // no second write, no second transition event, no re-notify.
        const alreadySettled = fulfillmentOrder.status.value !== "reservation_requested";
        if (!alreadySettled) {
          try {
            if (reservationResult.confirmed) {
              fulfillmentOrder.confirmReservation(
                this.deps.idGenerator.generate(),
                this.deps.clock.now(),
              );
            } else {
              fulfillmentOrder.failReservation(
                reservationResult.reason ?? "reservation_failed",
                this.deps.idGenerator.generate(),
                this.deps.clock.now(),
              );
            }
          } catch (error) {
            if (isDomainError(error)) return err(error);
            throw error;
          }

          await this.deps.fulfillmentOrders.save(fulfillmentOrder, tenantId, tx);
          await notifyBestEffort(this.deps, fulfillmentOrder, tenantId);
        }
        return ok({
          fulfillmentOrderId: fulfillmentOrder.id.toString(),
          status: fulfillmentOrder.status.value,
        });
      }),
    );
  }
}
