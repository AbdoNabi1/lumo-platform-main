import type { UseCase } from "@platform/application";
import { BusinessRuleError, isDomainError } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ConcurrencyError, type DomainError, NotFoundError } from "@platform/utils";
import type { FulfillmentOrderRepository } from "../domain/fulfillment-order-repository";
import { CarrierReference, TrackingNumber } from "../domain/value-objects/fulfillment-refs";
import type { FulfillmentOrderStatusOutput } from "./create-fulfillment.use-case";
import { notifyBestEffort, type FulfillmentLifecycleDeps } from "./fulfillment-lifecycle.use-cases";
import type { FulfillmentOrderIdInput } from "./fulfillment-lifecycle.use-cases";
import type { ProviderShipment, ShippingProviderPort } from "./ports";

export interface CreateShipmentDeps extends FulfillmentLifecycleDeps {
  readonly fulfillmentOrders: FulfillmentOrderRepository;
  readonly shippingProvider: ShippingProviderPort;
}

interface ShipmentPrecheck {
  /** Order is already `shipment_created` (idempotent resume) — skip the carrier call and return success as-is. */
  readonly alreadyShipped: boolean;
  readonly orderRef: string;
  readonly status: string;
}

/**
 * Bounded retry on optimistic-lock conflicts only (Phase A.15, reusing the shape Payments'
 * `withConcurrencyRetry` established in Phase A.4/A.8 — duplicated locally per this codebase's
 * established convention, not shared across packages).
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

/**
 * Requests a shipment from the carrier (`ShippingProviderPort.createShipment`, idempotency-keyed) —
 * records the carrier reference (`shipment_created`) and, if the carrier returns one immediately,
 * the tracking number (`tracking_assigned`) in the same step. Fulfillment never talks to a carrier
 * SDK directly.
 *
 * Phase A.15 (Task 2, cross-context transaction-boundary remediation — A.14 §11): the carrier call
 * used to run INSIDE the same `unitOfWork.run` transaction that read and would eventually persist
 * the order, holding a DB connection open for the full duration of a real network round-trip — the
 * same anti-pattern A.4/A.8/A.13.1 already closed for Payments/Returns. Unlike `RequestReservation`
 * (this same phase), `FulfillmentOrder`'s transition table has NO intermediate persistable status
 * between `packing_completed` and `shipment_created` (`fulfillment-status.ts`) — introducing one
 * would be a business-semantics/schema change this phase's brief explicitly forbids absent a
 * concrete defect requiring it. This reuses the simpler precheck/external-call/settle shape
 * `CollectInvoice` (Licensing, this same phase) established for exactly that shape:
 *   1. `precheck()` — a plain read: 404s if missing, short-circuits idempotently if already
 *      `shipment_created` (a retry of a call that already succeeded — no second carrier call, even
 *      though the carrier call itself is already idempotency-keyed), and rejects (same
 *      `BusinessRuleError` shape as before) if not `packing_completed`.
 *   2. The carrier `createShipment()` call, deliberately outside any open transaction.
 *   3. `settle()` — re-reads the order (a concurrent racer may have already advanced it past
 *      `packing_completed`, or fully to `shipment_created` — surfaced as the SAME domain error
 *      `createShipment()`/`assignTracking()` always threw for an illegal transition, returned via
 *      the `Result` channel, never swallowed), applies `createShipment()` and, if the carrier
 *      returned one, `assignTracking()`, and commits.
 *
 * RESIDUAL RISK (documented, not fixed by this phase — mirrors `CollectInvoice`'s identical gap):
 * `precheck()` is a plain read with no durable reservation write (unlike `RequestReservation`'s fix
 * in this same phase) — two callers that both read `packing_completed` before either commits can
 * both proceed to call the carrier. This is a SMALLER exposure than it looks: `ShippingProviderPort.
 * createShipment` IS idempotency-keyed (`<fulfillmentOrderId>:shipment`), so a duplicate physical
 * call does not create a second shipment at the carrier — but `settle()`'s own transition is still
 * only version-protected, not call-protected, exactly like `CollectInvoice`'s documented gap: the
 * losing racer's `settle()` cleanly returns the domain `BusinessRuleError` for the now-illegal
 * transition (via the `Result` channel) rather than corrupting state, but it did still make a
 * redundant carrier call. Closing that fully would require a new persisted `shipment_requested`
 * status (a schema/business-semantics change out of this phase's scope).
 */
export class CreateShipment implements UseCase<
  FulfillmentOrderIdInput,
  FulfillmentOrderStatusOutput,
  DomainError
> {
  private readonly deps: CreateShipmentDeps;
  private static readonly MAX_CONCURRENCY_RETRIES = 5;

  constructor(deps: CreateShipmentDeps) {
    this.deps = deps;
  }

  async execute(
    input: FulfillmentOrderIdInput,
  ): Promise<Result<FulfillmentOrderStatusOutput, DomainError>> {
    const precheck = await this.precheck(input.fulfillmentOrderId);
    if (!precheck.ok) return err(precheck.error);
    if (precheck.value.alreadyShipped) {
      return ok({ fulfillmentOrderId: input.fulfillmentOrderId, status: precheck.value.status });
    }
    const { orderRef } = precheck.value;

    const providerShipment = await this.deps.shippingProvider.createShipment({
      fulfillmentOrderId: input.fulfillmentOrderId,
      orderRef,
      idempotencyKey: `${input.fulfillmentOrderId}:shipment`,
    });

    return this.settle(input.fulfillmentOrderId, providerShipment);
  }

  private async precheck(
    fulfillmentOrderId: string,
  ): Promise<Result<ShipmentPrecheck, DomainError>> {
    return this.deps.unitOfWork.run<Result<ShipmentPrecheck, DomainError>>(async (tx) => {
      const fulfillmentOrder = await this.deps.fulfillmentOrders.findById(fulfillmentOrderId, tx);
      if (fulfillmentOrder === null) {
        return err(new NotFoundError("Fulfillment order not found"));
      }

      const orderRef = fulfillmentOrder.orderRef;
      if (fulfillmentOrder.status.value === "shipment_created") {
        return ok({ alreadyShipped: true, orderRef, status: fulfillmentOrder.status.value });
      }
      if (fulfillmentOrder.status.value !== "packing_completed") {
        return err(
          new BusinessRuleError(
            `Cannot transition fulfillment from "${fulfillmentOrder.status.value}" to "shipment_created"`,
          ),
        );
      }
      return ok({ alreadyShipped: false, orderRef, status: fulfillmentOrder.status.value });
    });
  }

  private async settle(
    fulfillmentOrderId: string,
    providerShipment: ProviderShipment,
  ): Promise<Result<FulfillmentOrderStatusOutput, DomainError>> {
    return withConcurrencyRetry(CreateShipment.MAX_CONCURRENCY_RETRIES, () =>
      this.deps.unitOfWork.run<Result<FulfillmentOrderStatusOutput, DomainError>>(async (tx) => {
        const fulfillmentOrder = await this.deps.fulfillmentOrders.findById(fulfillmentOrderId, tx);
        if (fulfillmentOrder === null) {
          return err(new NotFoundError("Fulfillment order not found"));
        }

        const carrierReference = CarrierReference.create(
          providerShipment.carrier,
          providerShipment.carrierShipmentId,
        );
        if (!carrierReference.ok) return err(carrierReference.error);

        try {
          fulfillmentOrder.createShipment(
            carrierReference.value,
            this.deps.idGenerator.generate(),
            this.deps.clock.now(),
          );

          if (providerShipment.trackingNumber !== undefined) {
            const trackingNumber = TrackingNumber.create(providerShipment.trackingNumber);
            if (!trackingNumber.ok) return err(trackingNumber.error);
            fulfillmentOrder.assignTracking(
              trackingNumber.value,
              this.deps.idGenerator.generate(),
              this.deps.clock.now(),
            );
          }
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }

        await this.deps.fulfillmentOrders.save(fulfillmentOrder, tx);
        await notifyBestEffort(this.deps, fulfillmentOrder);
        return ok({
          fulfillmentOrderId: fulfillmentOrder.id.toString(),
          status: fulfillmentOrder.status.value,
        });
      }),
    );
  }
}
