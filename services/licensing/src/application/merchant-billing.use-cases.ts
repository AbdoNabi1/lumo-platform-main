import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { Invoice } from "../domain/invoice";
import { planIdOfVersionRef, type Plan } from "../domain/plan";
import type { PlanVersion } from "../domain/plan-version";
import type {
  BillingPaymentMethodRepository,
  InvoiceRepository,
  PlanRepository,
  SubscriptionRepository,
} from "../domain/repositories";
import { findPinnedVersion, resolvePinnableVersion, type IdOutput } from "./licensing.use-cases";

/**
 * A merchant's own billing, as the merchant sees it (Task 5, merchant self-serve).
 *
 * Billing data is PLATFORM-owned (see `domain/repositories.ts`): subscriptions, invoices and saved
 * cards live under the platform scope as `tenantId`, and the merchant is the `tenantRef` business key
 * on each row. Every use case here therefore takes BOTH — and the caller (an admin route) supplies the
 * platform scope itself and the merchant from its own session, never from the request. Nothing here
 * accepts a subscription, invoice or price id from the client: the merchant can read and change only
 * the one subscription its `tenantRef` names, and choose among published plans by key.
 */
export interface MerchantBillingDeps {
  readonly plans: PlanRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly invoices: InvoiceRepository;
  readonly billingPaymentMethods: BillingPaymentMethodRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface MerchantPlanView {
  readonly key: string;
  readonly name: string;
  /** The published version's id — what a subscription pins. */
  readonly planVersionRef: string;
  readonly priceMinor: number;
  readonly currency: string;
  readonly billingCycle: "monthly" | "annual";
  readonly trialDays: number;
}

export interface MerchantInvoiceView {
  readonly id: string;
  readonly status: string;
  readonly totalMinor: number;
  readonly currency: string;
  readonly createdAt: string;
}

export interface MerchantBillingView {
  /** `null` ⇒ no subscription yet. */
  readonly plan: MerchantPlanView | null;
  /** The subscription status; `null` ⇒ no subscription yet. */
  readonly status: string | null;
  /** `renewalSchedule.nextRenewalAt`. */
  readonly nextChargeAt: string | null;
  /** Equal to `nextChargeAt` while no invoice exists and the pinned plan has a trial. */
  readonly trialEndsAt: string | null;
  readonly cardOnFile: boolean;
  readonly invoices: readonly MerchantInvoiceView[];
}

function planView(plan: Plan, version: PlanVersion): MerchantPlanView {
  const pricing = version.spec.pricing;
  return {
    key: plan.key,
    name: plan.name,
    planVersionRef: version.id.toString(),
    priceMinor: pricing.basePriceMinor,
    currency: pricing.currency,
    billingCycle: pricing.billingCycle,
    trialDays: pricing.trialDays ?? 0,
  };
}

function invoiceView(invoice: Invoice): MerchantInvoiceView {
  return {
    id: invoice.id.toString(),
    status: invoice.status,
    totalMinor: invoice.totalMinor,
    currency: invoice.currency,
    createdAt: invoice.createdAt?.toISOString() ?? "",
  };
}

export interface MerchantScopeInput {
  /** The merchant (the `tenantRef` business key) — from the caller's own session. */
  readonly tenantRef: string;
  /** The PLATFORM scope the billing rows live under. */
  readonly tenantId: string;
}

export class GetMerchantBilling implements UseCase<
  MerchantScopeInput,
  MerchantBillingView,
  DomainError
> {
  private readonly deps: MerchantBillingDeps;

  constructor(deps: MerchantBillingDeps) {
    this.deps = deps;
  }

  async execute(input: MerchantScopeInput): Promise<Result<MerchantBillingView, DomainError>> {
    const { tenantRef, tenantId } = input;
    const [subscription, invoices, method] = await Promise.all([
      this.deps.subscriptions.findByTenantRef(tenantRef, tenantId),
      this.deps.invoices.listByTenantRef(tenantRef, tenantId),
      this.deps.billingPaymentMethods.findActiveByTenantRef(tenantRef, tenantId),
    ]);
    const invoiceViews = invoices.map(invoiceView);
    const cardOnFile = method !== null;
    if (subscription === null) {
      return ok({
        plan: null,
        status: null,
        nextChargeAt: null,
        trialEndsAt: null,
        cardOnFile,
        invoices: invoiceViews,
      });
    }

    const version = await findPinnedVersion(this.deps.plans, subscription.planVersionRef);
    const planId = planIdOfVersionRef(subscription.planVersionRef);
    const plan = planId === null ? null : await this.deps.plans.findById(planId);
    const planPart = plan !== null && version !== undefined ? planView(plan, version) : null;

    const nextChargeAt = subscription.renewalSchedule?.nextRenewalAt.toISOString() ?? null;
    const inTrial = invoiceViews.length === 0 && (planPart?.trialDays ?? 0) > 0;
    return ok({
      plan: planPart,
      status: subscription.status,
      nextChargeAt,
      trialEndsAt: inTrial ? nextChargeAt : null,
      cardOnFile,
      invoices: invoiceViews,
    });
  }
}

/** The plans a merchant may choose from: every plan with a published version, cheapest first. */
export class ListPublishedPlans implements UseCase<
  Record<string, never>,
  readonly MerchantPlanView[],
  DomainError
> {
  private readonly deps: MerchantBillingDeps;

  constructor(deps: MerchantBillingDeps) {
    this.deps = deps;
  }

  async execute(
    _input?: Record<string, never>,
  ): Promise<Result<readonly MerchantPlanView[], DomainError>> {
    const plans = await this.deps.plans.listPublished();
    const views: MerchantPlanView[] = [];
    for (const plan of plans) {
      const version = plan.publishedVersion;
      if (version !== undefined) views.push(planView(plan, version));
    }
    return ok(views);
  }
}

export interface ResolveDefaultPlanVersionInput {
  readonly planKey: string;
}

/** The published version a new sign-up is pinned to: `NotFoundError` for an unknown or unpublished plan. */
export class ResolveDefaultPlanVersion implements UseCase<
  ResolveDefaultPlanVersionInput,
  { readonly planVersionRef: string },
  DomainError
> {
  private readonly deps: MerchantBillingDeps;

  constructor(deps: MerchantBillingDeps) {
    this.deps = deps;
  }

  async execute(
    input: ResolveDefaultPlanVersionInput,
  ): Promise<Result<{ readonly planVersionRef: string }, DomainError>> {
    const plan = await this.deps.plans.findByKey(input.planKey);
    const version = plan?.publishedVersion;
    if (version === undefined || version.status !== "published") {
      return err(new NotFoundError(`Plan "${input.planKey}" has no published version`));
    }
    return ok({ planVersionRef: version.id.toString() });
  }
}

export interface MerchantSubscriptionRef {
  readonly id: string;
  readonly status: string;
}

/**
 * The merchant's one subscription, by its `tenantRef`: its id and status. For platform-side callers
 * (the sign-up orchestrator resuming a trial that was created but not yet activated) — never routed.
 */
export class FindMerchantSubscription implements UseCase<
  MerchantScopeInput,
  MerchantSubscriptionRef,
  DomainError
> {
  private readonly deps: MerchantBillingDeps;

  constructor(deps: MerchantBillingDeps) {
    this.deps = deps;
  }

  async execute(input: MerchantScopeInput): Promise<Result<MerchantSubscriptionRef, DomainError>> {
    const subscription = await this.deps.subscriptions.findByTenantRef(
      input.tenantRef,
      input.tenantId,
    );
    if (subscription === null) return err(new NotFoundError("Subscription not found"));
    return ok({ id: subscription.id.toString(), status: subscription.status });
  }
}

export interface ChangeMerchantPlanInput extends MerchantScopeInput {
  readonly planKey: string;
}

/**
 * Re-pins the merchant's own subscription to another plan's published version (the same aggregate
 * move as `RepinSubscription`, but addressed by the merchant's ref and a plan KEY — the caller never
 * names a subscription or a version id).
 */
export class ChangeMerchantPlan implements UseCase<ChangeMerchantPlanInput, IdOutput, DomainError> {
  private readonly deps: MerchantBillingDeps;

  constructor(deps: MerchantBillingDeps) {
    this.deps = deps;
  }

  async execute(input: ChangeMerchantPlanInput): Promise<Result<IdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IdOutput, DomainError>>(async (tx) => {
      const subscription = await this.deps.subscriptions.findByTenantRef(
        input.tenantRef,
        input.tenantId,
        tx,
      );
      if (subscription === null) return err(new NotFoundError("Subscription not found"));
      const plan = await this.deps.plans.findByKey(input.planKey, tx);
      const target = plan?.publishedVersion;
      if (target === undefined) {
        return err(new NotFoundError(`Plan "${input.planKey}" has no published version`));
      }
      const targetRef = target.id.toString();
      const pinnable = await resolvePinnableVersion(this.deps.plans, targetRef, tx);
      if (!pinnable.ok) return err(pinnable.error);
      if (subscription.planVersionRef !== targetRef) {
        subscription.repin(targetRef, this.deps.idGenerator.generate(), this.deps.clock.now());
        await this.deps.subscriptions.save(subscription, input.tenantId, tx);
      }
      return ok({ id: subscription.id.toString() });
    });
  }
}
