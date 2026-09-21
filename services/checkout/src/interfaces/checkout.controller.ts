import type {
  CompleteCheckout,
  CompleteCheckoutInput,
} from "../application/complete-checkout.use-case";
import type { FailCheckout, FailCheckoutInput } from "../application/fail-checkout.use-case";
import type {
  GetCheckoutSession,
  GetCheckoutSessionInput,
} from "../application/get-checkout-session.use-case";
import type { StartCheckout, StartCheckoutInput } from "../application/start-checkout.use-case";
import type {
  LoadItems,
  LoadItemsInput,
  SelectPayment,
  SelectPaymentInput,
  SelectShipping,
  SelectShippingInput,
  SetAddressInput,
  SetBillingAddress,
  SetContactEmail,
  SetContactEmailInput,
  SetShippingAddress,
} from "../application/checkout-details.use-cases";
import type {
  CheckoutSessionIdInput,
  ExpireCheckout,
  Lock,
  RecalculateTotals,
  RequestShippingQuote,
  RequestTaxCalculation,
  ValidateCheckout,
  ValidatePromotion,
  ValidatePromotionInput,
} from "../application/checkout-orchestration.use-cases";
import type {
  GenerateOrderDraft,
  GeneratePaymentIntentRequest,
} from "../application/checkout-handoff.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface CheckoutControllerDeps {
  readonly startCheckout: StartCheckout;
  readonly getCheckoutSession: GetCheckoutSession;
  readonly completeCheckout: CompleteCheckout;
  readonly failCheckout: FailCheckout;
  readonly loadItems: LoadItems;
  readonly setBillingAddress: SetBillingAddress;
  readonly setShippingAddress: SetShippingAddress;
  readonly setContactEmail: SetContactEmail;
  readonly selectShipping: SelectShipping;
  readonly selectPayment: SelectPayment;
  readonly validateCheckout: ValidateCheckout;
  readonly requestTaxCalculation: RequestTaxCalculation;
  readonly requestShippingQuote: RequestShippingQuote;
  readonly validatePromotion: ValidatePromotion;
  readonly recalculateTotals: RecalculateTotals;
  readonly lock: Lock;
  readonly expireCheckout: ExpireCheckout;
  readonly generateOrderDraft: GenerateOrderDraft;
  readonly generatePaymentIntentRequest: GeneratePaymentIntentRequest;
}

/** Framework-agnostic interface boundary for checkout use-cases (no HTTP server). */
export class CheckoutController {
  private readonly deps: CheckoutControllerDeps;

  constructor(deps: CheckoutControllerDeps) {
    this.deps = deps;
  }

  async start(input: StartCheckoutInput): Promise<ControllerResponse> {
    return present(await this.deps.startCheckout.execute(input), 201);
  }

  async get(input: GetCheckoutSessionInput): Promise<ControllerResponse> {
    return present(await this.deps.getCheckoutSession.execute(input), 200);
  }

  async complete(input: CompleteCheckoutInput): Promise<ControllerResponse> {
    return present(await this.deps.completeCheckout.execute(input), 200);
  }

  async fail(input: FailCheckoutInput): Promise<ControllerResponse> {
    return present(await this.deps.failCheckout.execute(input), 200);
  }

  async loadItems(input: LoadItemsInput): Promise<ControllerResponse> {
    return present(await this.deps.loadItems.execute(input), 200);
  }

  async setBillingAddress(input: SetAddressInput): Promise<ControllerResponse> {
    return present(await this.deps.setBillingAddress.execute(input), 200);
  }

  async setShippingAddress(input: SetAddressInput): Promise<ControllerResponse> {
    return present(await this.deps.setShippingAddress.execute(input), 200);
  }

  async setContactEmail(input: SetContactEmailInput): Promise<ControllerResponse> {
    return present(await this.deps.setContactEmail.execute(input), 200);
  }

  async selectShipping(input: SelectShippingInput): Promise<ControllerResponse> {
    return present(await this.deps.selectShipping.execute(input), 200);
  }

  async selectPayment(input: SelectPaymentInput): Promise<ControllerResponse> {
    return present(await this.deps.selectPayment.execute(input), 200);
  }

  async validateCheckout(input: CheckoutSessionIdInput): Promise<ControllerResponse> {
    return present(await this.deps.validateCheckout.execute(input), 200);
  }

  async requestTaxCalculation(input: CheckoutSessionIdInput): Promise<ControllerResponse> {
    return present(await this.deps.requestTaxCalculation.execute(input), 200);
  }

  async requestShippingQuote(input: CheckoutSessionIdInput): Promise<ControllerResponse> {
    return present(await this.deps.requestShippingQuote.execute(input), 200);
  }

  async validatePromotion(input: ValidatePromotionInput): Promise<ControllerResponse> {
    return present(await this.deps.validatePromotion.execute(input), 200);
  }

  async recalculateTotals(input: CheckoutSessionIdInput): Promise<ControllerResponse> {
    return present(await this.deps.recalculateTotals.execute(input), 200);
  }

  async lock(input: CheckoutSessionIdInput): Promise<ControllerResponse> {
    return present(await this.deps.lock.execute(input), 200);
  }

  async expire(input: CheckoutSessionIdInput): Promise<ControllerResponse> {
    return present(await this.deps.expireCheckout.execute(input), 200);
  }

  async generateOrderDraft(input: CheckoutSessionIdInput): Promise<ControllerResponse> {
    return present(await this.deps.generateOrderDraft.execute(input), 200);
  }

  async generatePaymentIntentRequest(input: CheckoutSessionIdInput): Promise<ControllerResponse> {
    return present(await this.deps.generatePaymentIntentRequest.execute(input), 200);
  }
}
