import { err } from "@platform/types";
import { AuthorizationError } from "@platform/utils";
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
  BillSubscriptionRenewal,
  BillSubscriptionRenewalInput,
} from "../application/renewal.use-cases";
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
}
