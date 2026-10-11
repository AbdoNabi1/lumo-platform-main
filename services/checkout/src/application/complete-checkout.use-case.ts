import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { BusinessRuleError, type DomainError, NotFoundError } from "@platform/utils";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import type {
  InventoryValidationPort,
  OrderCancellationPort,
  OrderCreationPort,
  OrderStockReservationPort,
  StockReservationResult,
} from "./ports";

export interface CompleteCheckoutInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly checkoutSessionId: string;
  readonly idempotencyKey: string;
}

export interface CompleteCheckoutOutput {
  readonly checkoutSessionId: string;
  readonly state: string;
  readonly orderRef: string;
}

export interface CompleteCheckoutDeps {
  readonly sessions: CheckoutSessionRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly orderCreation: OrderCreationPort;
  /**
   * Plan 2B-3: when present, the session's items are checked against stock BEFORE the order is
   * created, and an insufficient result refuses the completion. Optional so callers that never
   * wired a stock source (and every earlier test) behave exactly as before.
   */
  readonly inventoryValidation?: InventoryValidationPort;
  /**
   * Plan 3C (G-114): when present, the stock is reserved for the order as soon as it is placed. The
   * validation above stays as the cheap first check; this is the race-proof second one — two
   * shoppers can both pass validation for the last unit, and only one can reserve it.
   */
  readonly stockReservation?: OrderStockReservationPort;
  /** Plan 3C: cancels the order when its stock could not be reserved. Optional, like the port above. */
  readonly orderCancellation?: OrderCancellationPort;
}

/**
 * Completes a checkout session by materializing the order via `OrderCreationPort` (C-2), emitting
 * `checkout.completed`. Idempotent per `idempotencyKey`: if the session was already completed by a
 * prior call (`session.orderRef !== null`), short-circuits and returns the recorded `orderRef`
 * without regenerating the order draft or calling the port again — Orders has no
 * `findByIdempotencyKey`, so this is done via session state rather than a repository lookup.
 */
export class CompleteCheckout implements UseCase<
  CompleteCheckoutInput,
  CompleteCheckoutOutput,
  DomainError
> {
  private readonly deps: CompleteCheckoutDeps;

  constructor(deps: CompleteCheckoutDeps) {
    this.deps = deps;
  }

  async execute(
    input: CompleteCheckoutInput,
  ): Promise<Result<CompleteCheckoutOutput, DomainError>> {
    const idempotencyKey = Guard.againstEmpty(input.idempotencyKey, "idempotencyKey");
    if (!idempotencyKey.ok) return err(idempotencyKey.error);

    return this.deps.unitOfWork.run<Result<CompleteCheckoutOutput, DomainError>>(async (tx) => {
      const session = await this.deps.sessions.findById(
        input.checkoutSessionId,
        input.tenantId,
        tx,
      );
      if (session === null) {
        return err(new NotFoundError("Checkout session not found"));
      }

      if (session.orderRef !== null) {
        return ok({
          checkoutSessionId: session.id.toString(),
          state: session.state.value,
          orderRef: session.orderRef,
        });
      }

      // C-2 fix-round-1: a failed/expired session still carries its items/addresses/totals from
      // before the transition (fail()/expire() don't clear them), so generateOrderDraft() below
      // would succeed and the real orderCreation.create() call would fire — creating a live,
      // orphaned order — before session.complete()'s own ensureOpen() ever gets a chance to reject
      // it. Reject here, before any side-effecting call, using the same "not open" rule
      // CheckoutSession's private ensureOpen() enforces (checkout-session.ts).
      if (!session.state.isOpen) {
        return err(
          new BusinessRuleError(
            `Checkout session is ${session.state.value} and can no longer be modified`,
          ),
        );
      }

      let draft;
      try {
        draft = session.generateOrderDraft();
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      // Plan 2B-3: refuse before the order exists, so a shopper never owns an order for stock that
      // is not there. The `OUT_OF_STOCK:` prefix is the contract the storefront reads. A session
      // that already completed returned above, so a retried complete never re-validates.
      if (this.deps.inventoryValidation !== undefined) {
        const stock = await this.deps.inventoryValidation.validate(session.items, input.tenantId);
        if (!stock.valid) {
          return err(
            new BusinessRuleError(`OUT_OF_STOCK: ${stock.reason ?? "insufficient stock"}`),
          );
        }
      }

      const { orderRef } = await this.deps.orderCreation.create({
        tenantId: input.tenantId,
        checkoutSessionId: session.id.toString(),
        customerRef: draft.customerRef,
        contactEmail: draft.contactEmail,
        currency: session.currency,
        items: draft.items,
        billingAddress: draft.billingAddress,
        shippingAddress: draft.shippingAddress,
        totals: draft.totals,
        ...(draft.shippingMethod === undefined ? {} : { shippingMethod: draft.shippingMethod }),
        idempotencyKey: input.idempotencyKey,
      });

      // Plan 3C (G-114): hold the stock for the order. If another shopper took it in the meantime,
      // undo the order — release whatever was held, cancel it — and refuse like the validation gate
      // does. The session is left untouched and open, exactly as that gate leaves it, so the shopper
      // can go back to the cart, adjust it, and complete again (which places a new order).
      if (this.deps.stockReservation !== undefined) {
        const reserved = await this.reserveStock(orderRef, session.items, input.tenantId);
        if (!reserved.ok) {
          await this.undoOrder(orderRef, input.tenantId);
          return err(new BusinessRuleError(`OUT_OF_STOCK: ${reserved.reason}`));
        }
      }

      try {
        session.complete(orderRef, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.sessions.save(session, input.tenantId, tx);
      return ok({ checkoutSessionId: session.id.toString(), state: session.state.value, orderRef });
    });
  }

  /** A reservation that throws is a failed reservation: the order must not stand on stock nobody holds. */
  private async reserveStock(
    orderRef: string,
    items: Parameters<OrderStockReservationPort["reserve"]>[1],
    tenantId: string,
  ): Promise<StockReservationResult> {
    try {
      // The port is present: the caller checked.
      return await (this.deps.stockReservation as OrderStockReservationPort).reserve(
        orderRef,
        items,
        tenantId,
      );
    } catch {
      return { ok: false, reason: "insufficient stock" };
    }
  }

  /** Releases what was held and cancels the order. Each step is best-effort: neither may mask the refusal. */
  private async undoOrder(orderRef: string, tenantId: string): Promise<void> {
    try {
      await this.deps.stockReservation?.release(orderRef, tenantId);
    } catch {
      // The cancellation below releases again; nothing more to do here.
    }
    try {
      await this.deps.orderCancellation?.cancel(orderRef, tenantId);
    } catch {
      // The shopper is told the stock is gone either way; the order is left for the merchant to cancel.
    }
  }
}
