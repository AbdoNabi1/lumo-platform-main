import type { CapturePayment, CapturePaymentInput } from "../application/capture-payment.use-case";
import type {
  CreatePaymentIntent,
  CreatePaymentIntentInput,
} from "../application/create-payment-intent.use-case";
import type { FailPayment, FailPaymentInput } from "../application/fail-payment.use-case";
import type {
  GetPaymentIntent,
  GetPaymentIntentInput,
} from "../application/get-payment-intent.use-case";
import type {
  AdvancePayment,
  AdvancePaymentInput,
  AuthorizePayment,
  AuthorizePaymentInput,
  CapturePaymentLifecycle,
  CreatePaymentIntentLifecycle,
  CreatePaymentIntentLifecycleInput,
  PaymentIntentIdInput,
  RefundPaymentLifecycle,
  RefundPaymentLifecycleInput,
} from "../application/payment-lifecycle.use-cases";
import type { RecordWebhook, RecordWebhookInput } from "../application/record-webhook.use-case";
import type { RefundPayment, RefundPaymentInput } from "../application/refund-payment.use-case";
import { type ControllerResponse, present } from "./presenter";

export interface PaymentControllerDeps {
  readonly createPaymentIntent: CreatePaymentIntent;
  readonly capturePayment: CapturePayment;
  readonly failPayment: FailPayment;
  readonly refundPayment: RefundPayment;
  readonly createPaymentIntentLifecycle: CreatePaymentIntentLifecycle;
  readonly advancePayment: AdvancePayment;
  readonly authorizePayment: AuthorizePayment;
  readonly capturePaymentLifecycle: CapturePaymentLifecycle;
  readonly refundPaymentLifecycle: RefundPaymentLifecycle;
  readonly recordWebhook: RecordWebhook;
  readonly getPaymentIntent: GetPaymentIntent;
}

/** Framework-agnostic interface boundary for payment use-cases (no HTTP server). */
export class PaymentController {
  private readonly deps: PaymentControllerDeps;

  constructor(deps: PaymentControllerDeps) {
    this.deps = deps;
  }

  async createIntent(input: CreatePaymentIntentInput): Promise<ControllerResponse> {
    return present(await this.deps.createPaymentIntent.execute(input), 201);
  }

  async capture(input: CapturePaymentInput): Promise<ControllerResponse> {
    return present(await this.deps.capturePayment.execute(input), 200);
  }

  async fail(input: FailPaymentInput): Promise<ControllerResponse> {
    return present(await this.deps.failPayment.execute(input), 200);
  }

  async refund(input: RefundPaymentInput): Promise<ControllerResponse> {
    return present(await this.deps.refundPayment.execute(input), 200);
  }

  async createIntentLifecycle(
    input: CreatePaymentIntentLifecycleInput,
  ): Promise<ControllerResponse> {
    return present(await this.deps.createPaymentIntentLifecycle.execute(input), 201);
  }

  async advance(input: AdvancePaymentInput): Promise<ControllerResponse> {
    return present(await this.deps.advancePayment.execute(input), 200);
  }

  async authorize(input: AuthorizePaymentInput): Promise<ControllerResponse> {
    return present(await this.deps.authorizePayment.execute(input), 200);
  }

  async captureLifecycle(input: PaymentIntentIdInput): Promise<ControllerResponse> {
    return present(await this.deps.capturePaymentLifecycle.execute(input), 200);
  }

  async refundLifecycle(input: RefundPaymentLifecycleInput): Promise<ControllerResponse> {
    return present(await this.deps.refundPaymentLifecycle.execute(input), 200);
  }

  async recordWebhook(input: RecordWebhookInput): Promise<ControllerResponse> {
    return present(await this.deps.recordWebhook.execute(input), 200);
  }

  async getPaymentIntent(input: GetPaymentIntentInput): Promise<ControllerResponse> {
    return present(await this.deps.getPaymentIntent.execute(input), 200);
  }
}
