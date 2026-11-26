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
import { ContactEmail } from "../domain/value-objects/contact-email";
import { PaymentSelection, ShippingSelection } from "../domain/value-objects/selections";
import {
  addressRuleIssues,
  addressRulesFor,
  cartLineLimitIssue,
  DEFAULT_CHECKOUT_SETTINGS,
  normalizeAddressInput,
} from "../domain/checkout-settings";
import type { CheckoutSettingsRepository } from "../domain/checkout-settings-repository";
import { provinceProblem } from "./address-province";
import type { PaymentMethodPort, ShippingCalculationPort } from "./ports";

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
    /** Plan 2A: the variant snapshot copied from the Cart line; all four absent on a legacy line. */
    readonly variantId?: string;
    readonly sku?: string;
    readonly title?: string;
    readonly variantTitle?: string | null;
  }[];
  /**
   * Wave 2a: the shop's add-to-cart limit. When given, a line over it is refused with the same
   * 422 `quantity` message the cart gives, so a cart filled before the limit was lowered (or past
   * the cart routes) cannot become an order. Absent => no limit.
   */
  readonly maxLineQuantity?: number | null;
}

/** The checkout lines for a cart snapshot, each validated (shared by LoadItems and the recovery claim). */
export function checkoutItemsFrom(
  raws: LoadItemsInput["items"],
): Result<CheckoutItem[], DomainError> {
  const items: CheckoutItem[] = [];
  for (const raw of raws) {
    const product = ProductRef.create(raw.productId);
    if (!product.ok) return err(product.error);
    const item = CheckoutItem.create(
      product.value.value,
      raw.quantity,
      raw.unitPriceAmountMinor,
      raw.currency,
      raw.variantId === undefined
        ? undefined
        : {
            variantRef: raw.variantId,
            sku: raw.sku ?? "",
            title: raw.title ?? "",
            variantTitle: raw.variantTitle ?? null,
          },
    );
    if (!item.ok) return err(item.error);
    items.push(item.value);
  }
  return ok(items);
}

/** Loads a snapshot of the cart's items into the session (caller-supplied — from Cart, never fetched here). */
export class LoadItems implements UseCase<LoadItemsInput, CheckoutDetailsOutput, DomainError> {
  private readonly deps: CheckoutDetailsDeps;

  constructor(deps: CheckoutDetailsDeps) {
    this.deps = deps;
  }

  async execute(input: LoadItemsInput): Promise<Result<CheckoutDetailsOutput, DomainError>> {
    const limit = input.maxLineQuantity ?? null;
    const over = input.items.find((raw) => cartLineLimitIssue(limit, raw.quantity) !== null);
    if (over !== undefined) {
      return err(
        new ValidationError("Cart limit exceeded", [
          cartLineLimitIssue(limit, over.quantity) as { field: string; message: string },
        ]),
      );
    }
    const built = checkoutItemsFrom(input.items);
    if (!built.ok) return err(built.error);
    const items = built.value;

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
    const problem = provinceProblem(input.country, input.province);
    if (problem !== null) return err(problem);

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

export interface SetShippingAddressDeps extends CheckoutDetailsDeps {
  /**
   * Wave 2a: when present, the address is held to the shop's checkout settings (name / phone /
   * address line 2) ON THE SERVER, so a stale or hand-made request cannot skip what the storefront
   * form would have asked for. Absent => no settings rules, exactly as before.
   */
  readonly settings?: CheckoutSettingsRepository;
}

/** Sets the session's shipping address snapshot. */
export class SetShippingAddress implements UseCase<
  SetAddressInput,
  CheckoutDetailsOutput,
  DomainError
> {
  private readonly deps: SetShippingAddressDeps;

  constructor(deps: SetShippingAddressDeps) {
    this.deps = deps;
  }

  async execute(rawInput: SetAddressInput): Promise<Result<CheckoutDetailsOutput, DomainError>> {
    let input = rawInput;
    if (this.deps.settings !== undefined) {
      const rules = addressRulesFor(await this.deps.settings.find(input.tenantId));
      const issues = addressRuleIssues(rules, input);
      if (issues.length > 0) return err(new ValidationError("Invalid address", issues));
      input = normalizeAddressInput(rules, input);
    }
    const address = CheckoutAddress.create(input);
    if (!address.ok) return err(address.error);
    const problem = provinceProblem(input.country, input.province);
    if (problem !== null) return err(problem);

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

export interface SetContactEmailInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly checkoutSessionId: string;
  readonly email: string;
  /**
   * Wave 2a: the shopper's answer to "email me news and offers". Kept only while the shop's
   * `marketingEmailPrompt` is not `hidden`; otherwise ignored (never stored). Absent = no answer sent.
   */
  readonly marketingOptIn?: boolean;
}

export interface SetContactEmailDeps extends CheckoutDetailsDeps {
  /** Wave 2a: absent => the prompt is treated as hidden (today's behaviour), so the answer is ignored. */
  readonly settings?: CheckoutSettingsRepository;
}

/**
 * Sets the address a guest's receipt goes to (WP-1, G-52). At completion, Identity resolves (finds
 * or creates) a guest customer from it so the order has a customer to attach to.
 */
export class SetContactEmail implements UseCase<
  SetContactEmailInput,
  CheckoutDetailsOutput,
  DomainError
> {
  private readonly deps: SetContactEmailDeps;

  constructor(deps: SetContactEmailDeps) {
    this.deps = deps;
  }

  async execute(input: SetContactEmailInput): Promise<Result<CheckoutDetailsOutput, DomainError>> {
    const email = ContactEmail.create(input.email);
    if (!email.ok) return err(email.error);

    const { settings, sessions, unitOfWork } = this.deps;
    return unitOfWork.run<Result<CheckoutDetailsOutput, DomainError>>(async (tx) => {
      const session = await sessions.findById(input.checkoutSessionId, input.tenantId, tx);
      if (session === null) return err(new NotFoundError("Checkout session not found"));
      try {
        session.setContactEmail(email.value);
        // Only a shop that SHOWS the box keeps the answer; a hidden prompt (or no settings row, whose
        // default is hidden) drops it, so a forged field cannot create a consent nobody was asked for.
        if (input.marketingOptIn !== undefined && settings !== undefined) {
          const row = await settings.find(input.tenantId, tx);
          const prompt = (row?.values ?? DEFAULT_CHECKOUT_SETTINGS).marketingEmailPrompt;
          if (prompt !== "hidden") session.setMarketingOptIn(input.marketingOptIn);
        }
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await sessions.save(session, input.tenantId, tx);
      return ok({ checkoutSessionId: session.id.toString() });
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
        session.items,
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
        { name: matched.name, description: matched.description },
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

export interface SelectPaymentDeps extends CheckoutDetailsDeps {
  readonly paymentMethods: PaymentMethodPort;
}

/**
 * Records the payment method the SHOPPER chose (never a captured instrument). WP-13: the choice is
 * validated against the methods the merchant currently offers — an unoffered method is refused, and
 * nothing is chosen in its place. This is the one place a method enters the session; every later
 * step (initiating payment) reads it back verbatim.
 */
export class SelectPayment implements UseCase<
  SelectPaymentInput,
  CheckoutDetailsOutput,
  DomainError
> {
  private readonly deps: SelectPaymentDeps;

  constructor(deps: SelectPaymentDeps) {
    this.deps = deps;
  }

  async execute(input: SelectPaymentInput): Promise<Result<CheckoutDetailsOutput, DomainError>> {
    const selection = PaymentSelection.create(input.paymentMethodRef, input.provider);
    if (!selection.ok) return err(selection.error);

    const offered = await this.deps.paymentMethods.enabledMethods(input.tenantId);
    if (!offered.includes(input.provider)) {
      return err(
        new ValidationError("Payment method is not available", [
          { field: "provider", message: "is not offered by this merchant" },
        ]),
      );
    }

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
