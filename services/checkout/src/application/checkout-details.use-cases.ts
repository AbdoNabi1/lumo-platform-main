import type { UseCase } from "@platform/application";
import { isDomainError, ProductRef } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import {
  type DomainError,
  BusinessRuleError,
  NotFoundError,
  ValidationError,
} from "@platform/utils";
import type { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import {
  CheckoutAddress,
  type CheckoutAddressInput,
} from "../domain/value-objects/checkout-address";
import { CheckoutItem } from "../domain/value-objects/checkout-item";
import { PaymentSelection, ShippingSelection } from "../domain/value-objects/selections";
import type { ShippingCalculationPort } from "./ports";

export interface CheckoutDetailsDeps {
  readonly sessions: CheckoutSessionRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
}

export interface CheckoutDetailsOutput {
  readonly checkoutSessionId: string;
}

async function withSession(
  deps: CheckoutDetailsDeps,
  checkoutSessionId: string,
  tenantId: string,
  mutate: (session: CheckoutSession) => Result<void, DomainError>,
): Promise<Result<CheckoutDetailsOutput, DomainError>> {
  return deps.unitOfWork.run<Result<CheckoutDetailsOutput, DomainError>>(async (tx) => {
    const session = await deps.sessions.findById(checkoutSessionId, tenantId, tx);
    if (session === null) {
      return err(new NotFoundError("Checkout session not found"));
    }
    const mutated = mutate(session);
    if (!mutated.ok) return err(mutated.error);
    await deps.sessions.save(session, tenantId, tx);
    return ok({ checkoutSessionId: session.id.toString() });
  });
}

export interface LoadItemsInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly checkoutSessionId: string;
  readonly items: readonly {
    readonly productId: string;
    readonly quantity: number;
    readonly unitPriceAmountMinor: number;
    readonly currency: string;
  }[];
}

/** Loads a snapshot of the cart's items into the session (caller-supplied — from Cart, never fetched here). */
export class LoadItems implements UseCase<LoadItemsInput, CheckoutDetailsOutput, DomainError> {
  private readonly deps: CheckoutDetailsDeps;

  constructor(deps: CheckoutDetailsDeps) {
    this.deps = deps;
  }

  async execute(input: LoadItemsInput): Promise<Result<CheckoutDetailsOutput, DomainError>> {
    const items: CheckoutItem[] = [];
    for (const raw of input.items) {
      const product = ProductRef.create(raw.productId);
      if (!product.ok) return err(product.error);
      const item = CheckoutItem.create(
        product.value.value,
        raw.quantity,
        raw.unitPriceAmountMinor,
        raw.currency,
      );
      if (!item.ok) return err(item.error);
      items.push(item.value);
    }

    return withSession(this.deps, input.checkoutSessionId, input.tenantId, (session) => {
      try {
        session.loadItems(items);
        return ok(undefined);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
    });
  }
}

export interface SetAddressInput extends CheckoutAddressInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly checkoutSessionId: string;
}

/** Sets the session's billing address snapshot. */
export class SetBillingAddress implements UseCase<
  SetAddressInput,
  CheckoutDetailsOutput,
  DomainError
> {
  private readonly deps: CheckoutDetailsDeps;

  constructor(deps: CheckoutDetailsDeps) {
    this.deps = deps;
  }

  async execute(input: SetAddressInput): Promise<Result<CheckoutDetailsOutput, DomainError>> {
    const address = CheckoutAddress.create(input);
    if (!address.ok) return err(address.error);

    return withSession(this.deps, input.checkoutSessionId, input.tenantId, (session) => {
      try {
        session.setBillingAddress(address.value);
        return ok(undefined);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
    });
  }
}

/** Sets the session's shipping address snapshot. */
export class SetShippingAddress implements UseCase<
  SetAddressInput,
  CheckoutDetailsOutput,
  DomainError
> {
  private readonly deps: CheckoutDetailsDeps;

  constructor(deps: CheckoutDetailsDeps) {
    this.deps = deps;
  }

  async execute(input: SetAddressInput): Promise<Result<CheckoutDetailsOutput, DomainError>> {
    const address = CheckoutAddress.create(input);
    if (!address.ok) return err(address.error);

    return withSession(this.deps, input.checkoutSessionId, input.tenantId, (session) => {
      try {
        session.setShippingAddress(address.value);
        return ok(undefined);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
    });
  }
}

export interface SelectShippingInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly checkoutSessionId: string;
  readonly method: string;
}

export interface SelectShippingDeps extends CheckoutDetailsDeps {
  readonly shippingCalculation: ShippingCalculationPort;
}

/**
 * Records the shipping method the customer chose. The rate is never caller-supplied — it is
 * re-derived server-side by re-querying `ShippingCalculationPort` (the same authoritative source
 * `RequestShippingQuote` already uses) and matching the chosen `method` against one of its quotes.
 */
export class SelectShipping implements UseCase<
  SelectShippingInput,
  CheckoutDetailsOutput,
  DomainError
> {
  private readonly deps: SelectShippingDeps;

  constructor(deps: SelectShippingDeps) {
    this.deps = deps;
  }

  async execute(input: SelectShippingInput): Promise<Result<CheckoutDetailsOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<CheckoutDetailsOutput, DomainError>>(async (tx) => {
      const session = await this.deps.sessions.findById(
        input.checkoutSessionId,
        input.tenantId,
        tx,
      );
      if (session === null) {
        return err(new NotFoundError("Checkout session not found"));
      }
      if (session.shippingAddress === undefined) {
        return err(
          new BusinessRuleError("Cannot select shipping before a shipping address is set"),
        );
      }

      const quotes = await this.deps.shippingCalculation.quote(
        session.shippingAddress,
        session.currency,
        input.tenantId,
      );
      const matched = quotes.find((quote) => quote.method === input.method);
      if (matched === undefined) {
        return err(
          new ValidationError("Unknown or unavailable shipping method", [
            { field: "method", message: "does not match any current shipping quote" },
          ]),
        );
      }

      const selection = ShippingSelection.create(
        matched.method,
        matched.rateAmountMinor,
        session.currency,
      );
      if (!selection.ok) return err(selection.error);

      try {
        session.selectShipping(selection.value);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.sessions.save(session, input.tenantId, tx);
      return ok({ checkoutSessionId: session.id.toString() });
    });
  }
}

export interface SelectPaymentInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly checkoutSessionId: string;
  readonly paymentMethodRef: string;
  readonly provider: string;
}

/** Records the payment method reference the customer chose (never a captured instrument). */
export class SelectPayment implements UseCase<
  SelectPaymentInput,
  CheckoutDetailsOutput,
  DomainError
> {
  private readonly deps: CheckoutDetailsDeps;

  constructor(deps: CheckoutDetailsDeps) {
    this.deps = deps;
  }

  async execute(input: SelectPaymentInput): Promise<Result<CheckoutDetailsOutput, DomainError>> {
    const selection = PaymentSelection.create(input.paymentMethodRef, input.provider);
    if (!selection.ok) return err(selection.error);

    return withSession(this.deps, input.checkoutSessionId, input.tenantId, (session) => {
      try {
        session.selectPayment(selection.value);
        return ok(undefined);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
    });
  }
}
