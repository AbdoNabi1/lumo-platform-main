import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { BusinessRuleError, isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { ConcurrencyError, type DomainError, NotFoundError } from "@platform/utils";
import type { Order } from "../domain/order";
import { canTransition, type OrderEventType } from "../domain/order-event";
import type { OrderRepository } from "../domain/order-repository";
import type { InventoryPort, NotificationPort, PaymentPort, ShippingPort } from "./ports";

/**
 * Bounded retry on optimistic-lock conflicts only (Phase A.15, reusing the shape Payments'
 * `withConcurrencyRetry` established in Phase A.4/A.8, and Licensing's `CollectInvoice` reused in
 * this same phase) — `PrismaOrderRepository.save` throws `ConcurrencyError` when a concurrent
 * writer already advanced the row's `version`; that is expected/recoverable (two racing settle
 * attempts for the same order), so the read-check-write attempt is retried from scratch against
 * the now-current row. Any other error propagates immediately.
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

export interface OrderStatusOutput {
  readonly orderId: string;
  readonly status: string;
}

/** Best-effort lifecycle notification — never blocks or fails the transition's own result. */
async function notifyBestEffort(
  notifications: NotificationPort | undefined,
  order: Order,
): Promise<void> {
  if (notifications === undefined) return;
  try {
    await notifications.notify(order.customerRef, order.orderNumber.value, order.status);
  } catch {
    // Best-effort: a notification failure never fails the order's own transition.
  }
}

export interface AdvanceOrderInput {
  readonly orderId: string;
  readonly toStatus: OrderEventType;
}

export interface AdvanceOrderDeps {
  readonly orders: OrderRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly notifications?: NotificationPort;
}

/** Generic validated transition — moves an order to any status its current status's transition table allows. */
export class AdvanceOrder implements UseCase<AdvanceOrderInput, OrderStatusOutput, DomainError> {
  private readonly deps: AdvanceOrderDeps;

  constructor(deps: AdvanceOrderDeps) {
    this.deps = deps;
  }

  async execute(input: AdvanceOrderInput): Promise<Result<OrderStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<OrderStatusOutput, DomainError>>(async (tx) => {
      const order = await this.deps.orders.findById(input.orderId, tx);
      if (order === null) {
        return err(new NotFoundError("Order not found"));
      }

      try {
        order.transition(input.toStatus, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.orders.save(order, tx);
      await notifyBestEffort(this.deps.notifications, order);
      return ok({ orderId: order.id.toString(), status: order.status });
    });
  }
}

export interface OrderIdInput {
  readonly orderId: string;
}

export interface RequestPaymentCaptureDeps {
  readonly orders: OrderRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly paymentPort: PaymentPort;
  readonly notifications?: NotificationPort;
}

interface RequestCapturePrecheck {
  /** Order already reached `payment_requested` (or beyond) with a recorded `paymentRef` — idempotent resume, skip the PSP call. */
  readonly alreadyRequested: boolean;
  readonly status: string;
  readonly amountMinor: number;
  readonly currency: string;
}

/**
 * Requests payment capture via `PaymentPort` — Orders never captures payment itself, only records
 * the returned ref.
 *
 * Phase A.15 (Task 1/2, cross-context transaction-boundary remediation — A.14 §11 finding #1): the
 * `PaymentPort.requestCapture` call used to run INSIDE the same `unitOfWork.run` transaction that
 * read and would eventually persist the order, holding a DB connection open for the full duration
 * of a real network round-trip (the same anti-pattern A.4/A.8/A.13.1 already closed for
 * Payments/Returns). `Order`'s status machine has no `capture_requested`-style intermediate status
 * distinct from `payment_requested` itself (`awaiting_payment -> payment_requested` IS the target
 * reached only after the external call returns) — adding one would be a schema/business-semantics
 * change this phase's brief forbids absent a concrete defect requiring it — so this reuses the
 * simpler precheck/external-call/settle shape Returns' `DecideResolution` (A.13.1) and Licensing's
 * `CollectInvoice` (this same phase) established for that exact shape:
 *   1. `precheck` — durably-committed-so-far read: 404s if missing, short-circuits idempotently if
 *      a `paymentRef` is already recorded (a retry of a call that already succeeded — no second PSP
 *      capture request), and rejects (same `BusinessRuleError` shape the domain's own `transition`
 *      would throw) if the current status cannot legally reach `payment_requested`.
 *   2. The PSP `requestCapture()` call, deliberately outside any open transaction.
 *   3. `settle` — re-reads the order (a concurrent racer may have already recorded a `paymentRef` —
 *      resumed as a no-op, exactly like Payments' `alreadyCaptured`/Licensing's `alreadyPaid`
 *      guards), applies `requestPayment`, and commits.
 * On failure of step 2 (`requestCapture` throws): unlike Licensing's `Invoice` (which can transition
 * `issued -> failed` directly), `Order`'s table has no `awaiting_payment -> payment_failed`
 * transition (`payment_failed` is only reachable FROM `payment_requested`) — there is no legal
 * target status to record a pre-request failure against, so (matching the exact pre-fix behavior)
 * the order is left completely unchanged and the original error simply propagates.
 *
 * RESIDUAL RISK (documented, not fixed by this phase — see report §Idempotency Analysis): like
 * Licensing's `collect()`, `PaymentPort.requestCapture()` takes no caller-supplied idempotency key
 * threaded from a durable reservation — `precheck()` is a plain read with no reservation write, so
 * two concurrent callers that both read "no paymentRef yet" before either commits can both proceed
 * to call `requestCapture()` — a genuine concurrent-double-request exposure. This is NOT a
 * regression: the pre-fix single-transaction version had the identical exposure (nothing took a row
 * lock or wrote a reservation before its own in-transaction PSP call either). Only one of the two
 * resulting `paymentRef`s is ever durably recorded (first settle to commit wins; the loser's settle
 * re-reads, finds a `paymentRef` already present, and no-ops) — see the regression tests.
 */
export class RequestPaymentCapture implements UseCase<
  OrderIdInput,
  OrderStatusOutput,
  DomainError
> {
  private readonly deps: RequestPaymentCaptureDeps;
  private static readonly MAX_CONCURRENCY_RETRIES = 5;

  constructor(deps: RequestPaymentCaptureDeps) {
    this.deps = deps;
  }

  async execute(input: OrderIdInput): Promise<Result<OrderStatusOutput, DomainError>> {
    const precheck = await this.precheck(input.orderId);
    if (!precheck.ok) return err(precheck.error);
    if (precheck.value.alreadyRequested) {
      return ok({ orderId: input.orderId, status: precheck.value.status });
    }
    const { amountMinor, currency } = precheck.value;

    const capture = await this.deps.paymentPort.requestCapture(
      input.orderId,
      amountMinor,
      currency,
    );

    return this.settle(input.orderId, capture.paymentRef);
  }

  private async precheck(orderId: string): Promise<Result<RequestCapturePrecheck, DomainError>> {
    return this.deps.unitOfWork.run<Result<RequestCapturePrecheck, DomainError>>(async (tx) => {
      const order = await this.deps.orders.findById(orderId, tx);
      if (order === null) {
        return err(new NotFoundError("Order not found"));
      }

      const context = {
        status: order.status,
        amountMinor: order.totalAmount().amountMinor,
        currency: order.currency,
      };
      if (order.paymentRef !== undefined) {
        return ok({ alreadyRequested: true, ...context });
      }
      if (!canTransition(order.status, "payment_requested")) {
        return err(
          new BusinessRuleError(
            `Cannot transition order from "${order.status}" to "payment_requested"`,
          ),
        );
      }
      return ok({ alreadyRequested: false, ...context });
    });
  }

  private async settle(
    orderId: string,
    paymentRef: string,
  ): Promise<Result<OrderStatusOutput, DomainError>> {
    return withConcurrencyRetry(RequestPaymentCapture.MAX_CONCURRENCY_RETRIES, () =>
      this.deps.unitOfWork.run<Result<OrderStatusOutput, DomainError>>(async (tx) => {
        const order = await this.deps.orders.findById(orderId, tx);
        if (order === null) {
          return err(new NotFoundError("Order not found"));
        }

        if (order.paymentRef === undefined) {
          try {
            order.requestPayment(
              paymentRef,
              this.deps.idGenerator.generate(),
              this.deps.clock.now(),
            );
          } catch (error) {
            if (isDomainError(error)) return err(error);
            throw error;
          }
          await this.deps.orders.save(order, tx);
          await notifyBestEffort(this.deps.notifications, order);
        }
        return ok({ orderId: order.id.toString(), status: order.status });
      }),
    );
  }
}

export interface RequestFulfillmentDeps {
  readonly orders: OrderRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly inventoryPort: InventoryPort;
  readonly shippingPort: ShippingPort;
  readonly notifications?: NotificationPort;
}

interface RequestFulfillmentPrecheck {
  /** Order already reached `fulfillment_requested` (or beyond) with a recorded `fulfillmentRef` — idempotent resume, skip both port calls. */
  readonly alreadyRequested: boolean;
  readonly status: string;
}

/**
 * Requests fulfillment via `InventoryPort` (reservation) + `ShippingPort` (shipment) — Orders
 * never moves stock itself.
 *
 * Phase A.15 (Task 2/2, cross-context transaction-boundary remediation — A.14 §11 finding #1): both
 * port calls used to run INSIDE the same `unitOfWork.run` transaction that read and would
 * eventually persist the order, holding a DB connection open for the full duration of TWO real
 * network round-trips. Same reasoning as `RequestPaymentCapture` above (`Order` has no
 * `fulfillment_being_requested`-style intermediate status distinct from `fulfillment_requested`
 * itself) — this reuses the same precheck/external-calls/settle shape:
 *   1. `precheck` — 404s if missing, short-circuits idempotently if a `fulfillmentRef` is already
 *      recorded, rejects (same `BusinessRuleError` shape the domain's own `transition` would throw)
 *      if the current status cannot legally reach `fulfillment_requested`.
 *   2. `InventoryPort.requestReservation()` then `ShippingPort.requestShipment()`, both deliberately
 *      outside any open transaction, in the same sequential order as before.
 *   3. `settle` — re-reads the order (idempotent no-op if a racer already recorded a
 *      `fulfillmentRef`), applies `requestFulfillment`, and commits.
 *
 * RESIDUAL RISK #1 — partial-failure orphan reservation (Phase A.16, Task 4/5 — MITIGATED, not
 * fully eliminated): if `requestReservation()` succeeds but the subsequent `requestShipment()`
 * throws, NOTHING is persisted locally — the domain transition + save only ever happen after BOTH
 * calls succeed (unchanged since A.15/pre-fix: `Order` has no intermediate status between
 * `ready_for_fulfillment` and `fulfillment_requested` to durably record a half-completed attempt,
 * and adding one would be a schema/business-semantics change out of this phase's scope — see Task 5
 * decision below). A caller retry therefore DOES call `requestReservation()` again — but as of this
 * phase, `InventoryPort`/`ShippingPort` both carry a documented Phase A.16 idempotency contract
 * (`ports.ts`): implementers MUST dedupe by `orderId` alone. `orderId` is already the natural,
 * pre-existing, stable correlation key passed to both calls (unlike Licensing's `collect()`, no port
 * signature change was needed to introduce it). Under that contract, the retry's second
 * `requestReservation(orderId)` call returns the SAME `reservationRef` the first call already
 * created — REUSED, not duplicated — closing the "orphan/duplicate reservation" failure mode this
 * risk originally named. See `request-fulfillment-orphan-reservation-recovery.test.ts`.
 *
 * Task 5 decision (why no schema change): `Order`'s own domain has no reusable correlation point for
 * "reservation requested, shipment not yet attempted" short of a new persisted field, and
 * Inventory's own `Reservation` aggregate (`services/inventory/src/domain/reservation.ts`) has no
 * find-by-reference lookup either — reserving twice with the same `reference` string today would
 * push two separate `Reservation` entities. Making `InventoryItem.reserve()` itself dedupe by
 * reference would be a cross-context domain change to a DIFFERENT bounded context, larger in scope
 * than this phase's brief allows absent a demonstrated defect specifically in Inventory's own
 * aggregate (there isn't one — Inventory was never audited as broken; Orders' calling pattern was).
 * Pushing the idempotency requirement onto the PORT/ADAPTER boundary instead (the same seam
 * Licensing's `collect()` and Shipping/Fulfillment's carrier calls already use this phase/A.15) is
 * the minimal fix that reuses an EXISTING correlation point (`orderId`) rather than inventing new
 * durable state — exactly what Task 5 asks for.
 *
 * RESIDUAL RISK #1, remaining honestly: this is a MITIGATION contingent on the real adapter honoring
 * the contract — like Licensing's PSP idempotency key, this cannot be verified against a live
 * provider because no real Inventory/Shipping adapter is wired anywhere in this repo yet (`services/
 * orders/src/infrastructure/in-memory-port-adapters.ts`'s `InMemoryInventoryAdapter`/
 * `InMemoryShippingAdapter` are the only implementations, used for dev/tests; they now correctly
 * implement the contract as the reference shape a real adapter must match). Also unchanged: Orders
 * still calls `requestReservation()` again on every retry (an extra, avoidable network round-trip) —
 * this fix makes that call SAFE, it does not make it disappear.
 *
 * RESIDUAL RISK #2 — concurrent double-request (same class of gap as `RequestPaymentCapture` and
 * Licensing's `collect()`): `precheck()` is a plain read with no reservation write, so two
 * concurrent callers that both read "no fulfillmentRef yet" before either commits can both proceed
 * to call BOTH ports — a genuine concurrent-duplicate-request exposure, not a regression (the
 * pre-fix single-transaction version had the identical exposure). Only one of the two resulting
 * `fulfillmentRef`s is ever durably recorded (first settle to commit wins; the loser's settle
 * re-reads, finds a `fulfillmentRef` already present, and no-ops).
 */
export class RequestFulfillment implements UseCase<OrderIdInput, OrderStatusOutput, DomainError> {
  private readonly deps: RequestFulfillmentDeps;
  private static readonly MAX_CONCURRENCY_RETRIES = 5;

  constructor(deps: RequestFulfillmentDeps) {
    this.deps = deps;
  }

  async execute(input: OrderIdInput): Promise<Result<OrderStatusOutput, DomainError>> {
    const precheck = await this.precheck(input.orderId);
    if (!precheck.ok) return err(precheck.error);
    if (precheck.value.alreadyRequested) {
      return ok({ orderId: input.orderId, status: precheck.value.status });
    }

    const reservation = await this.deps.inventoryPort.requestReservation(input.orderId);
    const shipment = await this.deps.shippingPort.requestShipment(input.orderId);

    return this.settle(input.orderId, `${reservation.reservationRef}|${shipment.shipmentRef}`);
  }

  private async precheck(
    orderId: string,
  ): Promise<Result<RequestFulfillmentPrecheck, DomainError>> {
    return this.deps.unitOfWork.run<Result<RequestFulfillmentPrecheck, DomainError>>(async (tx) => {
      const order = await this.deps.orders.findById(orderId, tx);
      if (order === null) {
        return err(new NotFoundError("Order not found"));
      }

      if (order.fulfillmentRef !== undefined) {
        return ok({ alreadyRequested: true, status: order.status });
      }
      if (!canTransition(order.status, "fulfillment_requested")) {
        return err(
          new BusinessRuleError(
            `Cannot transition order from "${order.status}" to "fulfillment_requested"`,
          ),
        );
      }
      return ok({ alreadyRequested: false, status: order.status });
    });
  }

  private async settle(
    orderId: string,
    fulfillmentRef: string,
  ): Promise<Result<OrderStatusOutput, DomainError>> {
    return withConcurrencyRetry(RequestFulfillment.MAX_CONCURRENCY_RETRIES, () =>
      this.deps.unitOfWork.run<Result<OrderStatusOutput, DomainError>>(async (tx) => {
        const order = await this.deps.orders.findById(orderId, tx);
        if (order === null) {
          return err(new NotFoundError("Order not found"));
        }

        if (order.fulfillmentRef === undefined) {
          try {
            order.requestFulfillment(
              fulfillmentRef,
              this.deps.idGenerator.generate(),
              this.deps.clock.now(),
            );
          } catch (error) {
            if (isDomainError(error)) return err(error);
            throw error;
          }
          await this.deps.orders.save(order, tx);
          await notifyBestEffort(this.deps.notifications, order);
        }
        return ok({ orderId: order.id.toString(), status: order.status });
      }),
    );
  }
}
