import type { UseCase } from "@platform/application";
import { isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { BusinessRuleError, type DomainError, NotFoundError } from "@platform/utils";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import type { PaymentInitiationPort, PaymentMethodPort } from "./ports";

export interface ListPaymentMethodsInput {
  /** ADR-0014: per-call tenant scope. */
  readonly tenantId: string;
}

export interface ListPaymentMethodsOutput {
  /** The methods the merchant offers. Carries no priority — nothing selects the first. */
  readonly methods: readonly string[];
}

/** What the shopper may choose between at checkout — a read of the merchant's own configuration. */
export class ListPaymentMethods implements UseCase<
  ListPaymentMethodsInput,
  ListPaymentMethodsOutput,
  DomainError
> {
  private readonly paymentMethods: PaymentMethodPort;

  constructor(deps: { readonly paymentMethods: PaymentMethodPort }) {
    this.paymentMethods = deps.paymentMethods;
  }

  async execute(
    input: ListPaymentMethodsInput,
  ): Promise<Result<ListPaymentMethodsOutput, DomainError>> {
    return ok({ methods: [...(await this.paymentMethods.enabledMethods(input.tenantId))] });
  }
}

export interface InitiatePaymentInput {
  /** ADR-0014: per-call tenant scope. */
  readonly tenantId: string;
  readonly checkoutSessionId: string;
}

export interface InitiatePaymentOutput {
  readonly checkoutSessionId: string;
  /** The method the shopper selected — echoed from the session, never chosen here. */
  readonly provider: string;
  readonly paymentIntentId: string;
  readonly status: string;
  /** Present only on the call that opened the intent. A repeat call resumes the same intent without one. */
  readonly clientHandle?: string;
}

export interface InitiatePaymentDeps {
  readonly sessions: CheckoutSessionRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly paymentInitiation: PaymentInitiationPort;
}

/**
 * Opens the payment for a COMPLETED checkout, using exactly the method the shopper selected.
 *
 * Nothing about the method is decided here: `provider` is read from the session's own
 * `paymentSelection` (set by `SelectPayment`, which validated it against what the merchant offers)
 * and handed to `PaymentInitiationPort` unchanged. The route accepts no `provider` of its own, so
 * there is no second place a method could be supplied — or a default applied. Amount and currency
 * are the session's server-derived totals, never a client value.
 *
 * Idempotent: the intent id is recorded on the session, so a repeat call (double-click, retry)
 * resumes the same intent rather than opening a second charge. (The hosted-checkout handle is not
 * persisted, so only the first call returns it.)
 *
 * Crash window, stated: the intent is opened, then recorded on the session in a second step. A
 * crash between the two leaves an orphan intent, and a retry opens another. Closing it needs the
 * intent to carry an idempotency key keyed on the checkout session — the same residual class
 * `OrderCreationAdapter` documents for order creation, and deliberately not widened here.
 */
export class InitiatePayment implements UseCase<
  InitiatePaymentInput,
  InitiatePaymentOutput,
  DomainError
> {
  private readonly deps: InitiatePaymentDeps;

  constructor(deps: InitiatePaymentDeps) {
    this.deps = deps;
  }

  async execute(input: InitiatePaymentInput): Promise<Result<InitiatePaymentOutput, DomainError>> {
    const session = await this.deps.sessions.findById(input.checkoutSessionId, input.tenantId);
    if (session === null) return err(new NotFoundError("Checkout session not found"));
    if (session.orderRef === null) {
      return err(new BusinessRuleError("Payment can only be initiated for a completed checkout"));
    }
    const selection = session.paymentSelection;
    if (selection === undefined) {
      return err(
        new BusinessRuleError("Payment cannot be initiated before a payment method is selected"),
      );
    }
    if (session.totals === undefined) {
      return err(new BusinessRuleError("Payment cannot be initiated before totals are calculated"));
    }

    if (session.paymentIntentRef !== undefined) {
      return ok({
        checkoutSessionId: session.id.toString(),
        provider: selection.provider,
        paymentIntentId: session.paymentIntentRef,
        status: "existing",
      });
    }

    const opened = await this.deps.paymentInitiation.initiate({
      tenantId: input.tenantId,
      orderRef: session.orderRef,
      provider: selection.provider,
      amountMinor: session.totals.totalMinor,
      currency: session.totals.currency,
    });

    const recorded = await this.deps.unitOfWork.run<Result<void, DomainError>>(async (tx) => {
      const current = await this.deps.sessions.findById(
        input.checkoutSessionId,
        input.tenantId,
        tx,
      );
      if (current === null) return err(new NotFoundError("Checkout session not found"));
      try {
        current.attachPaymentIntent(opened.paymentIntentId);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.sessions.save(current, input.tenantId, tx);
      return ok(undefined);
    });
    if (!recorded.ok) return err(recorded.error);

    return ok({
      checkoutSessionId: session.id.toString(),
      provider: opened.provider,
      paymentIntentId: opened.paymentIntentId,
      status: opened.status,
      ...(opened.clientHandle !== undefined ? { clientHandle: opened.clientHandle } : {}),
    });
  }
}
