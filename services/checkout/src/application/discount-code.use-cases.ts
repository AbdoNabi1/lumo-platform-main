import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, ValidationError } from "@platform/utils";
import type { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import { normalizeDiscountCode } from "../domain/value-objects/discount-snapshot";
import type { PromotionValidationPort } from "./ports";

/**
 * Asks Promotions for the session's discounts and stores the answer (Phase 2). A session no
 * discount has touched, and for which nothing applies, is left exactly as it was — so a legacy
 * admin `ValidatePromotion` snapshot is never overwritten with zero.
 */
export async function refreshDiscounts(
  session: CheckoutSession,
  port: PromotionValidationPort,
  tenantId: string,
): Promise<void> {
  const address = session.shippingAddress;
  const selection = session.shippingSelection;
  const snapshot = await port.evaluate({
    tenantId,
    items: session.items,
    shipping:
      address !== undefined && selection !== undefined
        ? { countryCode: address.country, rateMinor: selection.rateAmountMinor }
        : null,
    ...(session.customerRef === undefined ? {} : { customerRef: session.customerRef }),
    ...(session.contactEmail === undefined ? {} : { email: session.contactEmail.value }),
    codes: session.discountCodes,
  });
  if (snapshot.applied.length > 0 || session.hasDiscountState) {
    session.applyDiscountSnapshot(snapshot);
  }
}

export interface DiscountCodeInput {
  readonly tenantId: string;
  readonly checkoutSessionId: string;
  readonly code: string;
}

export interface DiscountCodeOutput {
  readonly checkoutSessionId: string;
  readonly state: string;
  readonly code: string;
  readonly applicable: boolean;
  readonly reason?: string;
}

interface DiscountCodeDeps {
  readonly sessions: CheckoutSessionRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly promotionValidation: PromotionValidationPort;
}

function recalculateIfPossible(session: CheckoutSession, deps: DiscountCodeDeps): void {
  if (session.items.length > 0) {
    session.recalculateTotals(deps.idGenerator.generate(), deps.clock.now());
  }
}

/**
 * A shopper enters a discount code (Phase 2). An accepted code stays on the session with its
 * discount in the totals; a rejected one is forgotten and counted towards the guessing limit.
 * Either way the answer is `ok` — whether the code applies is the outcome, not an error.
 */
export class AddDiscountCode implements UseCase<
  DiscountCodeInput,
  DiscountCodeOutput,
  DomainError
> {
  private readonly deps: DiscountCodeDeps;

  constructor(deps: DiscountCodeDeps) {
    this.deps = deps;
  }

  async execute(input: DiscountCodeInput): Promise<Result<DiscountCodeOutput, DomainError>> {
    const code = normalizeDiscountCode(input.code);
    if (code === "") {
      return err(
        new ValidationError("Invalid discount code", [{ field: "code", message: "required" }]),
      );
    }
    return this.deps.unitOfWork.run<Result<DiscountCodeOutput, DomainError>>(async (tx) => {
      const session = await this.deps.sessions.findById(
        input.checkoutSessionId,
        input.tenantId,
        tx,
      );
      if (session === null) return err(new NotFoundError("Checkout session not found"));
      const answer = (applicable: boolean, reason?: string): DiscountCodeOutput => ({
        checkoutSessionId: session.id.toString(),
        state: session.state.value,
        code,
        applicable,
        ...(reason === undefined ? {} : { reason }),
      });

      const now = this.deps.clock.now();
      if (session.isDiscountCodeEntryLocked(now)) return ok(answer(false, "too_many_attempts"));

      try {
        try {
          session.enterDiscountCode(code);
        } catch (error) {
          if (isDomainError(error) && error.message.startsWith("TOO_MANY_CODES")) {
            return ok(answer(false, "too_many_codes"));
          }
          throw error;
        }
        await refreshDiscounts(session, this.deps.promotionValidation, input.tenantId);
        const status = session.discountSnapshot?.codeStatuses.find((s) => s.code === code);
        const applicable = status?.applicable === true;
        if (!applicable) {
          session.removeDiscountCode(code);
          session.recordRejectedDiscountCode(now);
          await refreshDiscounts(session, this.deps.promotionValidation, input.tenantId);
        }
        recalculateIfPossible(session, this.deps);
        await this.deps.sessions.save(session, input.tenantId, tx);
        return ok(answer(applicable, applicable ? undefined : (status?.reason ?? "not_found")));
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
    });
  }
}

/** A shopper removes a code; the discounts are worked out again without it. */
export class RemoveDiscountCode implements UseCase<
  DiscountCodeInput,
  { readonly checkoutSessionId: string; readonly state: string },
  DomainError
> {
  private readonly deps: DiscountCodeDeps;

  constructor(deps: DiscountCodeDeps) {
    this.deps = deps;
  }

  async execute(
    input: DiscountCodeInput,
  ): Promise<Result<{ readonly checkoutSessionId: string; readonly state: string }, DomainError>> {
    return this.deps.unitOfWork.run<
      Result<{ readonly checkoutSessionId: string; readonly state: string }, DomainError>
    >(async (tx) => {
      const session = await this.deps.sessions.findById(
        input.checkoutSessionId,
        input.tenantId,
        tx,
      );
      if (session === null) return err(new NotFoundError("Checkout session not found"));
      try {
        session.removeDiscountCode(input.code);
        await refreshDiscounts(session, this.deps.promotionValidation, input.tenantId);
        recalculateIfPossible(session, this.deps);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.sessions.save(session, input.tenantId, tx);
      return ok({ checkoutSessionId: session.id.toString(), state: session.state.value });
    });
  }
}
