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
}

/** Framework-agnostic interface boundary for Licensing use-cases (no HTTP server). */
export class LicensingController {
  private readonly deps: LicensingControllerDeps;

  constructor(deps: LicensingControllerDeps) {
    this.deps = deps;
  }

  async createPlan(input: CreatePlanInput): Promise<ControllerResponse> {
    return present(await this.deps.createPlan.execute(input), 201);
  }

  async createPlanDraft(input: CreatePlanDraftInput): Promise<ControllerResponse> {
    return present(await this.deps.createPlanDraft.execute(input), 201);
  }

  async schedulePlanVersion(input: SchedulePlanVersionInput): Promise<ControllerResponse> {
    return present(await this.deps.schedulePlanVersion.execute(input), 200);
  }

  async publishPlanVersion(input: PlanVersionActionInput): Promise<ControllerResponse> {
    return present(await this.deps.publishPlanVersion.execute(input), 200);
  }

  async rollbackPlan(input: PlanVersionActionInput): Promise<ControllerResponse> {
    return present(await this.deps.rollbackPlan.execute(input), 200);
  }

  async clonePlanVersion(input: PlanVersionActionInput): Promise<ControllerResponse> {
    return present(await this.deps.clonePlanVersion.execute(input), 201);
  }

  async archivePlanVersion(input: PlanVersionActionInput): Promise<ControllerResponse> {
    return present(await this.deps.archivePlanVersion.execute(input), 200);
  }

  async comparePlanVersions(input: ComparePlanVersionsInput): Promise<ControllerResponse> {
    return present(await this.deps.comparePlanVersions.execute(input), 200);
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<ControllerResponse> {
    return present(await this.deps.createSubscription.execute(input), 201);
  }

  async repinSubscription(input: RepinSubscriptionInput): Promise<ControllerResponse> {
    return present(await this.deps.repinSubscription.execute(input), 200);
  }

  async activateSubscription(input: SubscriptionIdInput): Promise<ControllerResponse> {
    return present(await this.deps.activateSubscription.execute(input), 200);
  }

  async pauseSubscription(input: PauseSubscriptionInput): Promise<ControllerResponse> {
    return present(await this.deps.pauseSubscription.execute(input), 200);
  }

  async resumeSubscription(input: SubscriptionIdInput): Promise<ControllerResponse> {
    return present(await this.deps.resumeSubscription.execute(input), 200);
  }

  async cancelSubscription(input: CancelSubscriptionInput): Promise<ControllerResponse> {
    return present(await this.deps.cancelSubscription.execute(input), 200);
  }

  async previewRenewal(input: SubscriptionIdInput): Promise<ControllerResponse> {
    return present(await this.deps.previewRenewal.execute(input), 200);
  }

  async setMerchantFeatureOverride(
    input: SetMerchantFeatureOverrideInput,
  ): Promise<ControllerResponse> {
    return present(await this.deps.setMerchantFeatureOverride.execute(input), 200);
  }

  async grantMerchantCapability(input: GrantMerchantCapabilityInput): Promise<ControllerResponse> {
    return present(await this.deps.grantMerchantCapability.execute(input), 200);
  }

  async revokeMerchantCapability(
    input: RevokeMerchantCapabilityInput,
  ): Promise<ControllerResponse> {
    return present(await this.deps.revokeMerchantCapability.execute(input), 200);
  }

  async recordUsage(input: RecordUsageInput): Promise<ControllerResponse> {
    return present(await this.deps.recordUsage.execute(input), 200);
  }

  async getUsageCounter(input: GetUsageCounterInput): Promise<ControllerResponse> {
    return present(await this.deps.getUsageCounter.execute(input), 200);
  }

  async createInvoice(input: CreateInvoiceInput): Promise<ControllerResponse> {
    return present(await this.deps.createInvoice.execute(input), 201);
  }

  async issueInvoice(input: InvoiceIdInput): Promise<ControllerResponse> {
    return present(await this.deps.issueInvoice.execute(input), 200);
  }

  async collectInvoice(input: InvoiceIdInput): Promise<ControllerResponse> {
    return present(await this.deps.collectInvoice.execute(input), 200);
  }

  async grantCredit(input: GrantCreditInput): Promise<ControllerResponse> {
    return present(await this.deps.grantCredit.execute(input), 201);
  }

  async consumeCredit(input: ConsumeCreditInput): Promise<ControllerResponse> {
    return present(await this.deps.consumeCredit.execute(input), 200);
  }

  async expireCredit(input: CreditIdInput): Promise<ControllerResponse> {
    return present(await this.deps.expireCredit.execute(input), 200);
  }
}
