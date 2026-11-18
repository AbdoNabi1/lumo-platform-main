import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { BusinessRuleError, type DomainError, logger, NotFoundError } from "@platform/utils";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import { refreshDiscountsAndTax } from "./discount-code.use-cases";
import type {
  DiscountUsagePort,
  DraftOrderCompletionPort,
  InventoryValidationPort,
  OrderCancellationPort,
  OrderCreationPort,
  OrderStockReservationPort,
  PromotionValidationPort,
  StockReservationResult,
  TaxCalculationPort,
} from "./ports";

export interface CompleteCheckoutInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly checkoutSessionId: string;
  readonly idempotencyKey: string;
  /** Part 4: the staff member completing a draft (admin route only; never a public body). */
  readonly actorRef?: string;
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
  /** Phase 2: when present, the discounts are worked out once more right before the order exists. */
  readonly promotionValidation?: PromotionValidationPort;
  /** Phase 2: when present, a change of discounts re-works the tax that was already requested. */
  readonly taxCalculation?: TaxCalculationPort;
  /** Phase 2: when present, each discount's use is recorded after the order is placed (best effort). */
  readonly discountUsage?: DiscountUsagePort;
  /** Part 4: when present, a draft order's checkout reports the order to Orders (best effort). */
  readonly draftCompletion?: DraftOrderCompletionPort;
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

    // Parts 3 and 4: set inside the unit of work, read after it commits (properties, so TypeScript
    // does not narrow them to `undefined` across the callback).
    const after: { from?: string; draftOrderRef?: string } = {};
    const result = await this.deps.unitOfWork.run<Result<CompleteCheckoutOutput, DomainError>>(
      async (tx) => {
        const session = await this.deps.sessions.findById(
          input.checkoutSessionId,
          input.tenantId,
          tx,
        );
        if (session === null) {
          return err(new NotFoundError("Checkout session not found"));
        }
        after.from = session.recoveredFromRef;
        after.draftOrderRef = session.draftTerms?.draftOrderRef;

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

        // Phase 2: a code can run out, expire or stop qualifying between the last recalculation and
        // this click. Work the discounts out once more; if they moved, show the shopper the new total
        // instead of placing an order at a price they never saw. `DISCOUNTS_CHANGED:` is the prefix
        // the storefront reads, like `OUT_OF_STOCK:`.
        if (this.deps.promotionValidation !== undefined) {
          const taxBefore = session.taxMinor;
          try {
            const { discountsChanged } = await refreshDiscountsAndTax(
              session,
              {
                promotionValidation: this.deps.promotionValidation,
                taxCalculation: this.deps.taxCalculation,
              },
              input.tenantId,
            );
            if (discountsChanged || session.taxMinor !== taxBefore) {
              session.recalculateTotals(this.deps.idGenerator.generate(), this.deps.clock.now());
              await this.deps.sessions.save(session, input.tenantId, tx);
              return err(
                new BusinessRuleError(
                  "DISCOUNTS_CHANGED: the discounts changed; review the new total",
                ),
              );
            }
          } catch (error) {
            if (isDomainError(error)) return err(error);
            throw error;
          }
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
          ...(draft.discounts.length === 0 ? {} : { discounts: draft.discounts }),
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

        // Phase 2: count each discount's use. The order already exists, so a failure here must not
        // undo it; Coupons dedupes by order, and a retried completion returns early above.
        // A discount that took nothing off this order is not a use of it.
        const used = draft.discounts.filter((discount) => discount.amountMinor > 0);
        if (this.deps.discountUsage !== undefined && used.length > 0) {
          try {
            await this.deps.discountUsage.record({
              tenantId: input.tenantId,
              orderRef,
              ...(draft.customerRef === undefined ? {} : { customerRef: draft.customerRef }),
              ...(draft.contactEmail === undefined ? {} : { email: draft.contactEmail }),
              applied: used,
            });
          } catch {
            // Best effort by design (spec "Placing the order and recording usage").
          }
        }

        return ok({
          checkoutSessionId: session.id.toString(),
          state: session.state.value,
          orderRef,
        });
      },
    );

    if (result.ok && after.from !== undefined) {
      await this.markOriginalRecovered(after.from, result.value.orderRef, input.tenantId);
    }
    if (result.ok && after.draftOrderRef !== undefined) {
      await this.reportDraftCompletion(after.draftOrderRef, result.value.orderRef, input);
    }
    return result;
  }

  /**
   * Part 4 (Ruling 11): a draft order's checkout became `orderRef` — tell Orders, after the commit, best
   * effort: a refusal is logged with the port's own reason and never fails the order. The invoice links
   * are NOT revoked: a completed draft's link must still answer "this order has already been placed".
   * A retried completion returns early above and lands here again, so a missed report is sent again.
   */
  private async reportDraftCompletion(
    draftOrderRef: string,
    orderRef: string,
    input: CompleteCheckoutInput,
  ): Promise<void> {
    if (this.deps.draftCompletion === undefined) return;
    try {
      await this.deps.draftCompletion.complete({
        tenantId: input.tenantId,
        draftOrderRef,
        orderRef,
        ...(input.actorRef === undefined ? {} : { actorRef: input.actorRef }),
      });
    } catch (error) {
      logger.warn("could not record a draft order's completion", {
        tenantId: input.tenantId,
        draftOrderRef,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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

  /**
   * Order operations Part 3: the recovered checkout became `orderRef`, so the abandoned original is
   * stamped "Recovered" and expired — its own browser can no longer place it. Its OWN unit of work,
   * after the completion committed, and best effort: the order already exists (OrderCreationPort
   * commits on its own), so a conflict here (the original browser touched the session) must never
   * undo the completion. A retried completion returns early above and lands here again, so a missed
   * mark is healed. An original its shopper already placed, or one already marked, is left alone.
   */
  private async markOriginalRecovered(
    originalId: string,
    orderRef: string,
    tenantId: string,
  ): Promise<void> {
    try {
      await this.deps.unitOfWork.run(async (tx) => {
        const original = await this.deps.sessions.findById(originalId, tenantId, tx);
        if (
          original === null ||
          original.state.value === "completed" ||
          original.recoveredOrderRef !== undefined
        ) {
          return;
        }
        original.markRecovered(orderRef, this.deps.idGenerator.generate(), this.deps.clock.now());
        await this.deps.sessions.save(original, tenantId, tx);
      });
    } catch {
      // Best effort by design (see above); the list shows it as not recovered until a retry marks it.
    }
  }
}
