import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { BusinessRuleError, type DomainError, NotFoundError } from "@platform/utils";
import type { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import type {
  InventoryValidationPort,
  PricingValidationPort,
  PromotionValidationPort,
  ShippingCalculationPort,
  ShippingQuote,
  TaxCalculationPort,
} from "./ports";

export interface CheckoutSessionIdInput {
  readonly checkoutSessionId: string;
}

export interface CheckoutSessionStatusOutput {
  readonly checkoutSessionId: string;
  readonly state: string;
}

interface OrchestrationDeps {
  readonly sessions: CheckoutSessionRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

async function loadSession(
  sessions: CheckoutSessionRepository,
  checkoutSessionId: string,
  tx: unknown,
): Promise<Result<CheckoutSession, DomainError>> {
  const session = await sessions.findById(checkoutSessionId, tx);
  if (session === null) {
    return err(new NotFoundError("Checkout session not found"));
  }
  return ok(session);
}

export interface ValidateCheckoutOutput {
  readonly valid: boolean;
  readonly reason?: string;
}

/** Requests price + stock validation for the session's items via the Pricing/Inventory ports — never validates itself. */
export class ValidateCheckout implements UseCase<
  CheckoutSessionIdInput,
  ValidateCheckoutOutput,
  DomainError
> {
  private readonly deps: {
    readonly sessions: CheckoutSessionRepository;
    readonly pricingValidation: PricingValidationPort;
    readonly inventoryValidation: InventoryValidationPort;
  };

  constructor(deps: {
    readonly sessions: CheckoutSessionRepository;
    readonly pricingValidation: PricingValidationPort;
    readonly inventoryValidation: InventoryValidationPort;
  }) {
    this.deps = deps;
  }

  async execute(
    input: CheckoutSessionIdInput,
  ): Promise<Result<ValidateCheckoutOutput, DomainError>> {
    const session = await this.deps.sessions.findById(input.checkoutSessionId);
    if (session === null) {
      return err(new NotFoundError("Checkout session not found"));
    }

    const pricing = await this.deps.pricingValidation.validate(session.items, session.currency);
    if (!pricing.valid) {
      return ok({ valid: false, reason: pricing.reason ?? "pricing validation failed" });
    }
    const inventory = await this.deps.inventoryValidation.validate(session.items);
    if (!inventory.valid) {
      return ok({ valid: false, reason: inventory.reason ?? "inventory validation failed" });
    }
    return ok({ valid: true });
  }
}

export interface RequestTaxCalculationOutput extends CheckoutSessionStatusOutput {
  readonly taxMinor: number;
}

/** Requests a tax snapshot from Finance (`TaxCalculationPort`) and stores it verbatim. */
export class RequestTaxCalculation implements UseCase<
  CheckoutSessionIdInput,
  RequestTaxCalculationOutput,
  DomainError
> {
  private readonly deps: OrchestrationDeps & { readonly taxCalculation: TaxCalculationPort };

  constructor(deps: OrchestrationDeps & { readonly taxCalculation: TaxCalculationPort }) {
    this.deps = deps;
  }

  async execute(
    input: CheckoutSessionIdInput,
  ): Promise<Result<RequestTaxCalculationOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<RequestTaxCalculationOutput, DomainError>>(
      async (tx) => {
        const loaded = await loadSession(this.deps.sessions, input.checkoutSessionId, tx);
        if (!loaded.ok) return err(loaded.error);
        const session = loaded.value;

        if (session.shippingAddress === undefined) {
          return err(
            new BusinessRuleError(
              "Cannot request tax calculation before a shipping address is set",
            ),
          );
        }
        const result = await this.deps.taxCalculation.calculate(
          session.items,
          session.shippingAddress,
          session.currency,
        );

        try {
          session.applyTaxSnapshot(result.taxMinor);
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }

        await this.deps.sessions.save(session, tx);
        return ok({
          checkoutSessionId: session.id.toString(),
          state: session.state.value,
          taxMinor: result.taxMinor,
        });
      },
    );
  }
}

export interface RequestShippingQuoteOutput extends CheckoutSessionStatusOutput {
  readonly quotes: readonly ShippingQuote[];
}

/** Requests shipping rate quotes from Shipping (`ShippingCalculationPort`) — does not select one (see `SelectShipping`). */
export class RequestShippingQuote implements UseCase<
  CheckoutSessionIdInput,
  RequestShippingQuoteOutput,
  DomainError
> {
  private readonly deps: {
    readonly sessions: CheckoutSessionRepository;
    readonly shippingCalculation: ShippingCalculationPort;
  };

  constructor(deps: {
    readonly sessions: CheckoutSessionRepository;
    readonly shippingCalculation: ShippingCalculationPort;
  }) {
    this.deps = deps;
  }

  async execute(
    input: CheckoutSessionIdInput,
  ): Promise<Result<RequestShippingQuoteOutput, DomainError>> {
    const session = await this.deps.sessions.findById(input.checkoutSessionId);
    if (session === null) {
      return err(new NotFoundError("Checkout session not found"));
    }
    if (session.shippingAddress === undefined) {
      return err(
        new BusinessRuleError("Cannot request a shipping quote before a shipping address is set"),
      );
    }
    const quotes = await this.deps.shippingCalculation.quote(
      session.shippingAddress,
      session.currency,
    );
    return ok({ checkoutSessionId: session.id.toString(), state: session.state.value, quotes });
  }
}

export interface ValidatePromotionInput extends CheckoutSessionIdInput {
  readonly promotionRef?: string;
}

export interface ValidatePromotionOutput extends CheckoutSessionStatusOutput {
  readonly valid: boolean;
  readonly discountMinor: number;
}

/** Requests promotion/coupon validation (`PromotionValidationPort`) and stores the discount snapshot verbatim. */
export class ValidatePromotion implements UseCase<
  ValidatePromotionInput,
  ValidatePromotionOutput,
  DomainError
> {
  private readonly deps: OrchestrationDeps & {
    readonly promotionValidation: PromotionValidationPort;
  };

  constructor(deps: OrchestrationDeps & { readonly promotionValidation: PromotionValidationPort }) {
    this.deps = deps;
  }

  async execute(
    input: ValidatePromotionInput,
  ): Promise<Result<ValidatePromotionOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ValidatePromotionOutput, DomainError>>(async (tx) => {
      const loaded = await loadSession(this.deps.sessions, input.checkoutSessionId, tx);
      if (!loaded.ok) return err(loaded.error);
      const session = loaded.value;

      const result = await this.deps.promotionValidation.validate(
        session.items,
        session.customerRef,
        input.promotionRef,
        session.currency,
      );
      if (!result.valid) {
        return ok({
          checkoutSessionId: session.id.toString(),
          state: session.state.value,
          valid: false,
          discountMinor: 0,
        });
      }

      try {
        session.applyPromotionSnapshot(result.discountMinor);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.sessions.save(session, tx);
      return ok({
        checkoutSessionId: session.id.toString(),
        state: session.state.value,
        valid: true,
        discountMinor: result.discountMinor,
      });
    });
  }
}

/** Assembles `CheckoutTotals` as a sum of the session's already-stored snapshots. */
export class RecalculateTotals implements UseCase<
  CheckoutSessionIdInput,
  CheckoutSessionStatusOutput,
  DomainError
> {
  private readonly deps: OrchestrationDeps;

  constructor(deps: OrchestrationDeps) {
    this.deps = deps;
  }

  async execute(
    input: CheckoutSessionIdInput,
  ): Promise<Result<CheckoutSessionStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<CheckoutSessionStatusOutput, DomainError>>(
      async (tx) => {
        const loaded = await loadSession(this.deps.sessions, input.checkoutSessionId, tx);
        if (!loaded.ok) return err(loaded.error);
        const session = loaded.value;

        try {
          session.recalculateTotals(this.deps.idGenerator.generate(), this.deps.clock.now());
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }

        await this.deps.sessions.save(session, tx);
        return ok({ checkoutSessionId: session.id.toString(), state: session.state.value });
      },
    );
  }
}

/** Locks the session against further detail changes while the purchase saga runs. */
export class Lock implements UseCase<
  CheckoutSessionIdInput,
  CheckoutSessionStatusOutput,
  DomainError
> {
  private readonly deps: OrchestrationDeps;

  constructor(deps: OrchestrationDeps) {
    this.deps = deps;
  }

  async execute(
    input: CheckoutSessionIdInput,
  ): Promise<Result<CheckoutSessionStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<CheckoutSessionStatusOutput, DomainError>>(
      async (tx) => {
        const loaded = await loadSession(this.deps.sessions, input.checkoutSessionId, tx);
        if (!loaded.ok) return err(loaded.error);
        const session = loaded.value;

        try {
          session.lock(this.deps.idGenerator.generate(), this.deps.clock.now());
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }

        await this.deps.sessions.save(session, tx);
        return ok({ checkoutSessionId: session.id.toString(), state: session.state.value });
      },
    );
  }
}

/** Expires a still-open checkout session (started/locked). */
export class ExpireCheckout implements UseCase<
  CheckoutSessionIdInput,
  CheckoutSessionStatusOutput,
  DomainError
> {
  private readonly deps: OrchestrationDeps;

  constructor(deps: OrchestrationDeps) {
    this.deps = deps;
  }

  async execute(
    input: CheckoutSessionIdInput,
  ): Promise<Result<CheckoutSessionStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<CheckoutSessionStatusOutput, DomainError>>(
      async (tx) => {
        const loaded = await loadSession(this.deps.sessions, input.checkoutSessionId, tx);
        if (!loaded.ok) return err(loaded.error);
        const session = loaded.value;

        try {
          session.expire(this.deps.idGenerator.generate(), this.deps.clock.now());
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }

        await this.deps.sessions.save(session, tx);
        return ok({ checkoutSessionId: session.id.toString(), state: session.state.value });
      },
    );
  }
}
