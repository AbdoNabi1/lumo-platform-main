import { err } from "@platform/types";
import { AuthorizationError, NotFoundError } from "@platform/utils";
import type {
  ActivateSubscription,
  ArchivePlanVersion,
  CancelSubscription,
  CancelSubscriptionInput,
  ClonePlanVersion,
  ComparePlanVersions,
  ComparePlanVersionsInput,
  CreatePlan,
  CreatePlanDraft,
  CreatePlanDraftInput,
  CreatePlanInput,
  CreateSubscription,
  CreateSubscriptionInput,
  GetUsageCounter,
  GetUsageCounterInput,
  GrantMerchantCapability,
  GrantMerchantCapabilityInput,
  PauseSubscription,
  PauseSubscriptionInput,
  PlanVersionActionInput,
  PreviewRenewal,
  PublishPlanVersion,
  RecordUsage,
  RecordUsageInput,
  RepinSubscription,
  RepinSubscriptionInput,
  ResumeSubscription,
  RevokeMerchantCapability,
  RevokeMerchantCapabilityInput,
  RollbackPlan,
  SchedulePlanVersion,
  SchedulePlanVersionInput,
  SetMerchantFeatureOverride,
  SetMerchantFeatureOverrideInput,
  SubscriptionIdInput,
} from "../application/licensing.use-cases";
import type {
  CollectInvoice,
  ConsumeCredit,
  ConsumeCreditInput,
  CreateInvoice,
  CreateInvoiceInput,
  CreditIdInput,
  ExpireCredit,
  GrantCredit,
  GrantCreditInput,
  InvoiceIdInput,
  IssueInvoice,
} from "../application/billing.use-cases";
import type {
  CouponActionInput,
  ExpireCoupon,
  IssueCoupon,
  IssueCouponInput,
  RedeemCoupon,
  RedeemCouponInput,
  RevokeCoupon,
  RevokeCouponInput,
} from "../application/coupon.use-cases";
import type {
  BeginCardEnrolment,
  BeginCardEnrolmentInput,
  RecordCardToken,
  RecordCardTokenInput,
  RecordInvoiceTransaction,
  RecordInvoiceTransactionInput,
  RevokeBillingPaymentMethod,
  RevokeBillingPaymentMethodInput,
} from "../application/payment-method.use-cases";
import type {
  BillSubscriptionRenewal,
  BillSubscriptionRenewalInput,
} from "../application/renewal.use-cases";
import type {
  EnterDunning,
  EnterDunningInput,
  ListDueInput,
  ListSubscriptionsDueForDunningRetry,
  ListSubscriptionsDueForRenewal,
  RetryDunningInvoice,
  RetryDunningInvoiceInput,
} from "../application/dunning.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface LicensingControllerDeps {
  readonly createPlan: CreatePlan;
  readonly createPlanDraft: CreatePlanDraft;
  readonly schedulePlanVersion: SchedulePlanVersion;
  readonly publishPlanVersion: PublishPlanVersion;
  readonly rollbackPlan: RollbackPlan;
  readonly clonePlanVersion: ClonePlanVersion;
  readonly archivePlanVersion: ArchivePlanVersion;
  readonly comparePlanVersions: ComparePlanVersions;
  readonly createSubscription: CreateSubscription;
  readonly repinSubscription: RepinSubscription;
  readonly activateSubscription: ActivateSubscription;
  readonly pauseSubscription: PauseSubscription;
  readonly resumeSubscription: ResumeSubscription;
  readonly cancelSubscription: CancelSubscription;
  readonly previewRenewal: PreviewRenewal;
  readonly billSubscriptionRenewal: BillSubscriptionRenewal;
  /** T14.5 (dunning) — the renewal-billing scheduler job's own read; platform-only like every other billing operation. */
  readonly listSubscriptionsDueForRenewal: ListSubscriptionsDueForRenewal;
  readonly listSubscriptionsDueForDunningRetry: ListSubscriptionsDueForDunningRetry;
  readonly enterDunning: EnterDunning;
  readonly retryDunningInvoice: RetryDunningInvoice;
  readonly setMerchantFeatureOverride: SetMerchantFeatureOverride;
  readonly grantMerchantCapability: GrantMerchantCapability;
  readonly revokeMerchantCapability: RevokeMerchantCapability;
  readonly recordUsage: RecordUsage;
  readonly getUsageCounter: GetUsageCounter;
  readonly createInvoice: CreateInvoice;
  readonly issueInvoice: IssueInvoice;
  readonly collectInvoice: CollectInvoice;
  readonly grantCredit: GrantCredit;
  readonly consumeCredit: ConsumeCredit;
  readonly expireCredit: ExpireCredit;
  /** T14.3 (D-072): coupons. Every operation is platform-only — issuance AND redemption. */
  readonly issueCoupon: IssueCoupon;
  readonly redeemCoupon: RedeemCoupon;
  readonly expireCoupon: ExpireCoupon;
  readonly revokeCoupon: RevokeCoupon;
  /**
   * Saved-card use cases (G-74 (1)). Present only when the deployment composes stored-method billing;
   * absent ⇒ the operations answer 404, never a silent success.
   */
  readonly beginCardEnrolment?: BeginCardEnrolment;
  readonly recordCardToken?: RecordCardToken;
  /** G-74 (8): the billing TRANSACTION callback that settles the first invoice. Same presence rule as above. */
  readonly recordInvoiceTransaction?: RecordInvoiceTransaction;
  readonly revokeBillingPaymentMethod?: RevokeBillingPaymentMethod;
  /**
   * The platform-operator tenant (WP-14, T14.2). Present ⇒ every operation that PRICES or GRANTS a
   * subscription (plans, subscriptions, overrides, capabilities, invoices, credits, renewal billing)
   * refuses a caller whose tenant is not this one with a 403 — a merchant tenant holding a
   * `licensing:*` permission still cannot price its own bill, whatever a route or RLS would say.
   * Absent ⇒ a single-tenant deployment, where the one tenant IS the platform operator.
   * Usage recording/reading and read-only previews stay open to the merchant's own scope.
   */
  readonly platformTenantId?: string;
}

/** Framework-agnostic interface boundary for Licensing use-cases (no HTTP server). */
export class LicensingController {
  private readonly deps: LicensingControllerDeps;

  constructor(deps: LicensingControllerDeps) {
    this.deps = deps;
  }

  /**
   * Runs `run` only for the platform-operator tenant. Deliberately at THIS boundary rather than in
   * each route: any caller of the controller (an HTTP route, a worker, a later admin surface) gets
   * the refusal, so a new route cannot forget it.
   */
  private async platformOnly(
    input: { readonly tenantId: string },
    run: () => Promise<ControllerResponse>,
  ): Promise<ControllerResponse> {
    const platform = this.deps.platformTenantId;
    if (platform !== undefined && input.tenantId !== platform) {
      return present(
        err(
          new AuthorizationError(
            "Plans, subscriptions and billing are platform-owned: a merchant tenant may not create, price or grant them",
          ),
        ),
        403,
      );
    }
    return run();
  }

  async createPlan(input: CreatePlanInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.createPlan.execute(input), 201),
    );
  }

  async createPlanDraft(input: CreatePlanDraftInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.createPlanDraft.execute(input), 201),
    );
  }

  async schedulePlanVersion(input: SchedulePlanVersionInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.schedulePlanVersion.execute(input), 200),
    );
  }

  async publishPlanVersion(input: PlanVersionActionInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.publishPlanVersion.execute(input), 200),
    );
  }

  async rollbackPlan(input: PlanVersionActionInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.rollbackPlan.execute(input), 200),
    );
  }

  async clonePlanVersion(input: PlanVersionActionInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.clonePlanVersion.execute(input), 201),
    );
  }

  async archivePlanVersion(input: PlanVersionActionInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.archivePlanVersion.execute(input), 200),
    );
  }

  async comparePlanVersions(input: ComparePlanVersionsInput): Promise<ControllerResponse> {
    return present(await this.deps.comparePlanVersions.execute(input), 200);
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.createSubscription.execute(input), 201),
    );
  }

  async repinSubscription(input: RepinSubscriptionInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.repinSubscription.execute(input), 200),
    );
  }

  async activateSubscription(input: SubscriptionIdInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.activateSubscription.execute(input), 200),
    );
  }

  async pauseSubscription(input: PauseSubscriptionInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.pauseSubscription.execute(input), 200),
    );
  }

  async resumeSubscription(input: SubscriptionIdInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.resumeSubscription.execute(input), 200),
    );
  }

  async cancelSubscription(input: CancelSubscriptionInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.cancelSubscription.execute(input), 200),
    );
  }

  async previewRenewal(input: SubscriptionIdInput): Promise<ControllerResponse> {
    return present(await this.deps.previewRenewal.execute(input), 200);
  }

  /** WP-14 T14.4: bills one renewal period at the subscription's PINNED price through the platform PSP. */
  async billSubscriptionRenewal(input: BillSubscriptionRenewalInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.billSubscriptionRenewal.execute(input), 200),
    );
  }

  /** T14.5: subscriptions due for renewal billing, under the platform tenant scope only. */
  async listSubscriptionsDueForRenewal(input: ListDueInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.listSubscriptionsDueForRenewal.execute(input), 200),
    );
  }

  /** T14.5: subscriptions due for a dunning retry, under the platform tenant scope only. */
  async listSubscriptionsDueForDunningRetry(input: ListDueInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.listSubscriptionsDueForDunningRetry.execute(input), 200),
    );
  }

  /** T14.5: a renewal charge just failed — opens the dunning grace period and schedules the first retry. */
  async enterDunning(input: EnterDunningInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.enterDunning.execute(input), 200),
    );
  }

  /** T14.5: runs one scheduled dunning retry (re-issue + collect) for a subscription in grace. */
  async retryDunningInvoice(input: RetryDunningInvoiceInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.retryDunningInvoice.execute(input), 200),
    );
  }

  /**
   * G-74 (1) step 1: starts the merchant's interactive first payment for an issued invoice (a normal
   * 3DS checkout on Morbeh's own PSP account, which is what makes the PSP issue a card token).
   * Platform-only: a merchant tenant may not start, and cannot see, the flow that stores its card.
   */
  async beginCardEnrolment(input: BeginCardEnrolmentInput): Promise<ControllerResponse> {
    const useCase = this.deps.beginCardEnrolment;
    if (useCase === undefined) return notConfigured();
    return this.platformOnly(input, async () => present(await useCase.execute(input), 200));
  }

  /**
   * G-74 (1) step 2: the PSP's card-token callback. NOT `platformOnly`: the caller is the PSP, whose
   * only credential is the callback's HMAC (verified inside the use case), not a tenant. The scope it
   * writes under is therefore PINNED to the platform tenant, whatever `input.tenantId` says — a caller
   * cannot make a token land in (or be read from) a merchant's own tenant scope.
   */
  async recordCardToken(input: RecordCardTokenInput): Promise<ControllerResponse> {
    const useCase = this.deps.recordCardToken;
    if (useCase === undefined) return notConfigured();
    const tenantId = this.deps.platformTenantId ?? input.tenantId;
    return present(await useCase.execute({ ...input, tenantId }), 200);
  }

  /**
   * G-74 (8): Morbeh's billing TRANSACTION callback — settles the merchant's first invoice once the
   * PSP confirms it. NOT `platformOnly`, for the same reason as `recordCardToken`: the caller is the
   * PSP, authenticated by the callback's own signature (checked inside the use case), not a tenant.
   * The scope is pinned to the platform tenant regardless of what `input.tenantId` names.
   */
  async recordInvoiceTransaction(
    input: RecordInvoiceTransactionInput,
  ): Promise<ControllerResponse> {
    const useCase = this.deps.recordInvoiceTransaction;
    if (useCase === undefined) return notConfigured();
    const tenantId = this.deps.platformTenantId ?? input.tenantId;
    return present(await useCase.execute({ ...input, tenantId }), 200);
  }

  /** Removes the merchant's active card: the next renewal then fails visibly. Platform-only. */
  async revokeBillingPaymentMethod(
    input: RevokeBillingPaymentMethodInput,
  ): Promise<ControllerResponse> {
    const useCase = this.deps.revokeBillingPaymentMethod;
    if (useCase === undefined) return notConfigured();
    return this.platformOnly(input, async () => present(await useCase.execute(input), 200));
  }

  async setMerchantFeatureOverride(
    input: SetMerchantFeatureOverrideInput,
  ): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.setMerchantFeatureOverride.execute(input), 200),
    );
  }

  async grantMerchantCapability(input: GrantMerchantCapabilityInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.grantMerchantCapability.execute(input), 200),
    );
  }

  async revokeMerchantCapability(
    input: RevokeMerchantCapabilityInput,
  ): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.revokeMerchantCapability.execute(input), 200),
    );
  }

  async recordUsage(input: RecordUsageInput): Promise<ControllerResponse> {
    return present(await this.deps.recordUsage.execute(input), 200);
  }

  async getUsageCounter(input: GetUsageCounterInput): Promise<ControllerResponse> {
    return present(await this.deps.getUsageCounter.execute(input), 200);
  }

  async createInvoice(input: CreateInvoiceInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.createInvoice.execute(input), 201),
    );
  }

  async issueInvoice(input: InvoiceIdInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.issueInvoice.execute(input), 200),
    );
  }

  async collectInvoice(input: InvoiceIdInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.collectInvoice.execute(input), 200),
    );
  }

  async grantCredit(input: GrantCreditInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.grantCredit.execute(input), 201),
    );
  }

  async consumeCredit(input: ConsumeCreditInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.consumeCredit.execute(input), 200),
    );
  }

  async expireCredit(input: CreditIdInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.expireCredit.execute(input), 200),
    );
  }

  /**
   * T14.3: issues a coupon. Platform-only, at THIS boundary like every other pricing operation: a
   * merchant tenant holding any `licensing:*` permission must not be able to issue itself a 100% coupon.
   */
  async issueCoupon(input: IssueCouponInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.issueCoupon.execute(input), 201),
    );
  }

  /**
   * T14.3: redeems a coupon onto a DRAFT invoice. Platform-only too — not merely issuance. Invoices
   * live in the platform's tenant scope, which a merchant's own scope cannot read, so a merchant-facing
   * redeem would need this controller to pin the scope to the platform's the way the PSP callbacks do:
   * a bearer code would then let any merchant session pick ANY invoice id and discount it. An operator
   * applies the code a merchant presents instead (see D-072).
   */
  async redeemCoupon(input: RedeemCouponInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.redeemCoupon.execute(input), 200),
    );
  }

  async expireCoupon(input: CouponActionInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.expireCoupon.execute(input), 200),
    );
  }

  async revokeCoupon(input: RevokeCouponInput): Promise<ControllerResponse> {
    return this.platformOnly(input, async () =>
      present(await this.deps.revokeCoupon.execute(input), 200),
    );
  }
}

function notConfigured(): ControllerResponse {
  return present(err(new NotFoundError("Stored-method billing is not configured")), 200);
}
