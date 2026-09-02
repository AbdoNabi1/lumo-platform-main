import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ConflictError, NotFoundError, isDomainError } from "@platform/utils";
import type { CapabilityGrantSource } from "../domain/merchant-capabilities";
import { MerchantCapabilities } from "../domain/merchant-capabilities";
import {
  MerchantFeatureOverride,
  type MerchantOverrideState,
} from "../domain/merchant-feature-override";
import { Plan, type PlanTier } from "../domain/plan";
import type {
  MerchantCapabilitiesRepository,
  MerchantFeatureOverrideRepository,
  PlanRepository,
  SubscriptionRepository,
  UsageCounterRepository,
} from "../domain/repositories";
import { Subscription } from "../domain/subscription";
import { UsageCounter } from "../domain/usage-counter";
import type { PlanSpec } from "../domain/value-objects/plan-spec";
import type { ProcessedUsageRecordStore } from "./ports";

export interface LicensingDeps {
  readonly plans: PlanRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly merchantFeatureOverrides: MerchantFeatureOverrideRepository;
  readonly merchantCapabilities: MerchantCapabilitiesRepository;
  readonly usageCounters: UsageCounterRepository;
  readonly processedUsageRecords: ProcessedUsageRecordStore;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface IdOutput {
  readonly id: string;
}

export interface CreatePlanInput {
  readonly key: string;
  readonly name: string;
  readonly tier: PlanTier;
}

/** Creates a plan product — one per `key`. */
export class CreatePlan implements UseCase<CreatePlanInput, IdOutput, DomainError> {
  private readonly deps: LicensingDeps;

  constructor(deps: LicensingDeps) {
    this.deps = deps;
  }

  async execute(input: CreatePlanInput): Promise<Result<IdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IdOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.plans.findByKey(input.key, tx);
      if (existing !== null) return err(new ConflictError(`Plan "${input.key}" already exists`));
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const plan = Plan.create(
        id,
        input.key,
        input.name,
        input.tier,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.plans.save(plan, tx);
      return ok({ id: id.toString() });
    });
  }
}

export interface CreatePlanDraftInput {
  readonly planId: string;
  readonly spec: PlanSpec;
}

export interface PlanVersionIdOutput {
  readonly planVersionId: string;
}

/** Creates a new draft version on an existing plan. */
export class CreatePlanDraft implements UseCase<
  CreatePlanDraftInput,
  PlanVersionIdOutput,
  DomainError
> {
  private readonly deps: LicensingDeps;

  constructor(deps: LicensingDeps) {
    this.deps = deps;
  }

  async execute(input: CreatePlanDraftInput): Promise<Result<PlanVersionIdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<PlanVersionIdOutput, DomainError>>(async (tx) => {
      const plan = await this.deps.plans.findById(input.planId, tx);
      if (plan === null) return err(new NotFoundError("Plan not found"));
      const draft = plan.createDraft(
        input.spec,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.plans.save(plan, tx);
      return ok({ planVersionId: draft.id.toString() });
    });
  }
}

export interface PlanVersionActionInput {
  readonly planId: string;
  readonly planVersionId: string;
}

export interface SchedulePlanVersionInput extends PlanVersionActionInput {
  readonly publishAt: Date;
}

/** Schedules a draft version for future publish. */
export class SchedulePlanVersion implements UseCase<
  SchedulePlanVersionInput,
  IdOutput,
  DomainError
> {
  private readonly deps: LicensingDeps;

  constructor(deps: LicensingDeps) {
    this.deps = deps;
  }

  async execute(input: SchedulePlanVersionInput): Promise<Result<IdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IdOutput, DomainError>>(async (tx) => {
      const plan = await this.deps.plans.findById(input.planId, tx);
      if (plan === null) return err(new NotFoundError("Plan not found"));
      try {
        plan.schedule(
          input.planVersionId,
          input.publishAt,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.plans.save(plan, tx);
      return ok({ id: input.planVersionId });
    });
  }
}

/** Publishes a version — never affects existing subscribers pinned to a different version id. */
export class PublishPlanVersion implements UseCase<PlanVersionActionInput, IdOutput, DomainError> {
  private readonly deps: LicensingDeps;

  constructor(deps: LicensingDeps) {
    this.deps = deps;
  }

  async execute(input: PlanVersionActionInput): Promise<Result<IdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IdOutput, DomainError>>(async (tx) => {
      const plan = await this.deps.plans.findById(input.planId, tx);
      if (plan === null) return err(new NotFoundError("Plan not found"));
      try {
        plan.publish(input.planVersionId, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.plans.save(plan, tx);
      return ok({ id: input.planVersionId });
    });
  }
}

/** Re-points the published pointer to a previously published version. */
export class RollbackPlan implements UseCase<PlanVersionActionInput, IdOutput, DomainError> {
  private readonly deps: LicensingDeps;

  constructor(deps: LicensingDeps) {
    this.deps = deps;
  }

  async execute(input: PlanVersionActionInput): Promise<Result<IdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IdOutput, DomainError>>(async (tx) => {
      const plan = await this.deps.plans.findById(input.planId, tx);
      if (plan === null) return err(new NotFoundError("Plan not found"));
      try {
        plan.rollback(input.planVersionId, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.plans.save(plan, tx);
      return ok({ id: input.planVersionId });
    });
  }
}

/** Clones a draft from an existing version's spec. */
export class ClonePlanVersion implements UseCase<
  PlanVersionActionInput,
  PlanVersionIdOutput,
  DomainError
> {
  private readonly deps: LicensingDeps;

  constructor(deps: LicensingDeps) {
    this.deps = deps;
  }

  async execute(input: PlanVersionActionInput): Promise<Result<PlanVersionIdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<PlanVersionIdOutput, DomainError>>(async (tx) => {
      const plan = await this.deps.plans.findById(input.planId, tx);
      if (plan === null) return err(new NotFoundError("Plan not found"));
      const clone = plan.clone(
        input.planVersionId,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.plans.save(plan, tx);
      return ok({ planVersionId: clone.id.toString() });
    });
  }
}

/** Archives a version. */
export class ArchivePlanVersion implements UseCase<PlanVersionActionInput, IdOutput, DomainError> {
  private readonly deps: LicensingDeps;

  constructor(deps: LicensingDeps) {
    this.deps = deps;
  }

  async execute(input: PlanVersionActionInput): Promise<Result<IdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IdOutput, DomainError>>(async (tx) => {
      const plan = await this.deps.plans.findById(input.planId, tx);
      if (plan === null) return err(new NotFoundError("Plan not found"));
      try {
        plan.archive(input.planVersionId, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.plans.save(plan, tx);
      return ok({ id: input.planVersionId });
    });
  }
}

export interface ComparePlanVersionsInput {
  readonly planId: string;
  readonly planVersionAId: string;
  readonly planVersionBId: string;
}

export interface ComparePlanVersionsOutput {
  readonly diff: Readonly<Record<string, boolean>>;
}

/** Diffs two versions section-by-section (Sprint-5.6 addendum §G). */
export class ComparePlanVersions implements UseCase<
  ComparePlanVersionsInput,
  ComparePlanVersionsOutput,
  DomainError
> {
  private readonly deps: LicensingDeps;

  constructor(deps: LicensingDeps) {
    this.deps = deps;
  }

  async execute(
    input: ComparePlanVersionsInput,
  ): Promise<Result<ComparePlanVersionsOutput, DomainError>> {
    const plan = await this.deps.plans.findById(input.planId);
    if (plan === null) return err(new NotFoundError("Plan not found"));
    try {
      const diff = plan.compare(input.planVersionAId, input.planVersionBId);
      return ok({ diff });
    } catch (error) {
      if (isDomainError(error)) return err(error);
      throw error;
    }
  }
}

export interface CreateSubscriptionInput {
  readonly tenantRef: string;
  readonly planVersionRef: string;
}

/** Starts a trial subscription — one per `tenantRef`. */
export class CreateSubscription implements UseCase<CreateSubscriptionInput, IdOutput, DomainError> {
  private readonly deps: LicensingDeps;

  constructor(deps: LicensingDeps) {
    this.deps = deps;
  }

  async execute(input: CreateSubscriptionInput): Promise<Result<IdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IdOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.subscriptions.findByTenantRef(input.tenantRef, tx);
      if (existing !== null) {
        return err(new ConflictError(`Tenant "${input.tenantRef}" already has a subscription`));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const subscription = Subscription.startTrial(
        id,
        input.tenantRef,
        input.planVersionRef,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.subscriptions.save(subscription, tx);
      return ok({ id: id.toString() });
    });
  }
}

export interface SubscriptionIdInput {
  readonly subscriptionId: string;
}

export interface RepinSubscriptionInput extends SubscriptionIdInput {
  readonly newPlanVersionRef: string;
}

/** Re-pins a subscription to a different immutable plan version (upgrade/downgrade). */
export class RepinSubscription implements UseCase<RepinSubscriptionInput, IdOutput, DomainError> {
  private readonly deps: LicensingDeps;

  constructor(deps: LicensingDeps) {
    this.deps = deps;
  }

  async execute(input: RepinSubscriptionInput): Promise<Result<IdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IdOutput, DomainError>>(async (tx) => {
      const subscription = await this.deps.subscriptions.findById(input.subscriptionId, tx);
      if (subscription === null) return err(new NotFoundError("Subscription not found"));
      subscription.repin(
        input.newPlanVersionRef,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.subscriptions.save(subscription, tx);
      return ok({ id: subscription.id.toString() });
    });
  }
}

/** Activates a trial/grace/suspended subscription. */
export class ActivateSubscription implements UseCase<SubscriptionIdInput, IdOutput, DomainError> {
  private readonly deps: LicensingDeps;

  constructor(deps: LicensingDeps) {
    this.deps = deps;
  }

  async execute(input: SubscriptionIdInput): Promise<Result<IdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IdOutput, DomainError>>(async (tx) => {
      const subscription = await this.deps.subscriptions.findById(input.subscriptionId, tx);
      if (subscription === null) return err(new NotFoundError("Subscription not found"));
      try {
        subscription.activate(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.subscriptions.save(subscription, tx);
      return ok({ id: subscription.id.toString() });
    });
  }
}

export interface PauseSubscriptionInput extends SubscriptionIdInput {
  readonly resumeDate: Date;
}

/** Pauses a subscription with a resume date. */
export class PauseSubscription implements UseCase<PauseSubscriptionInput, IdOutput, DomainError> {
  private readonly deps: LicensingDeps;

  constructor(deps: LicensingDeps) {
    this.deps = deps;
  }

  async execute(input: PauseSubscriptionInput): Promise<Result<IdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IdOutput, DomainError>>(async (tx) => {
      const subscription = await this.deps.subscriptions.findById(input.subscriptionId, tx);
      if (subscription === null) return err(new NotFoundError("Subscription not found"));
      subscription.pause(input.resumeDate, this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.subscriptions.save(subscription, tx);
      return ok({ id: subscription.id.toString() });
    });
  }
}

/** Resumes a paused subscription. */
export class ResumeSubscription implements UseCase<SubscriptionIdInput, IdOutput, DomainError> {
  private readonly deps: LicensingDeps;

  constructor(deps: LicensingDeps) {
    this.deps = deps;
  }

  async execute(input: SubscriptionIdInput): Promise<Result<IdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IdOutput, DomainError>>(async (tx) => {
      const subscription = await this.deps.subscriptions.findById(input.subscriptionId, tx);
      if (subscription === null) return err(new NotFoundError("Subscription not found"));
      subscription.resume(this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.subscriptions.save(subscription, tx);
      return ok({ id: subscription.id.toString() });
    });
  }
}

export interface CancelSubscriptionInput extends SubscriptionIdInput {
  readonly reason: string;
}

/** Cancels a subscription with a reason. */
export class CancelSubscription implements UseCase<CancelSubscriptionInput, IdOutput, DomainError> {
  private readonly deps: LicensingDeps;

  constructor(deps: LicensingDeps) {
    this.deps = deps;
  }

  async execute(input: CancelSubscriptionInput): Promise<Result<IdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IdOutput, DomainError>>(async (tx) => {
      const subscription = await this.deps.subscriptions.findById(input.subscriptionId, tx);
      if (subscription === null) return err(new NotFoundError("Subscription not found"));
      try {
        subscription.cancel(input.reason, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.subscriptions.save(subscription, tx);
      return ok({ id: subscription.id.toString() });
    });
  }
}

export interface PreviewRenewalOutput {
  readonly nextRenewalAt: Date | undefined;
  readonly planVersionRef: string;
}

/** Read-only projection of a subscription's next charge. */
export class PreviewRenewal implements UseCase<
  SubscriptionIdInput,
  PreviewRenewalOutput,
  DomainError
> {
  private readonly deps: LicensingDeps;

  constructor(deps: LicensingDeps) {
    this.deps = deps;
  }

  async execute(input: SubscriptionIdInput): Promise<Result<PreviewRenewalOutput, DomainError>> {
    const subscription = await this.deps.subscriptions.findById(input.subscriptionId);
    if (subscription === null) return err(new NotFoundError("Subscription not found"));
    return ok(subscription.previewRenewal());
  }
}

export interface SetMerchantFeatureOverrideInput {
  readonly tenantRef: string;
  readonly featureKey: string;
  readonly state: MerchantOverrideState;
  readonly expiresAt?: Date;
  readonly notes?: string;
}

/** Creates or updates the legacy merchant feature override (Sprint 5.5, kept for compatibility). */
export class SetMerchantFeatureOverride implements UseCase<
  SetMerchantFeatureOverrideInput,
  IdOutput,
  DomainError
> {
  private readonly deps: LicensingDeps;

  constructor(deps: LicensingDeps) {
    this.deps = deps;
  }

  async execute(input: SetMerchantFeatureOverrideInput): Promise<Result<IdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IdOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.merchantFeatureOverrides.findByTenantRefAndFeatureKey(
        input.tenantRef,
        input.featureKey,
        tx,
      );
      if (existing !== null) {
        existing.setState(
          input.state,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
          input.expiresAt,
          input.notes,
        );
        await this.deps.merchantFeatureOverrides.save(existing, tx);
        return ok({ id: existing.id.toString() });
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const override = MerchantFeatureOverride.create(
        id,
        input.tenantRef,
        input.featureKey,
        input.state,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
        input.expiresAt,
        input.notes,
      );
      await this.deps.merchantFeatureOverrides.save(override, tx);
      return ok({ id: id.toString() });
    });
  }
}

export interface GrantMerchantCapabilityInput {
  readonly tenantRef: string;
  readonly featureKey: string;
  readonly enabled: boolean;
  readonly source: CapabilityGrantSource;
  readonly expiresAt?: Date;
  readonly reason?: string;
  readonly notes?: string;
}

/** Grants (or updates) a merchant capability — the go-forward operational layer (Sprint 5.6). */
export class GrantMerchantCapability implements UseCase<
  GrantMerchantCapabilityInput,
  IdOutput,
  DomainError
> {
  private readonly deps: LicensingDeps;

  constructor(deps: LicensingDeps) {
    this.deps = deps;
  }

  async execute(input: GrantMerchantCapabilityInput): Promise<Result<IdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IdOutput, DomainError>>(async (tx) => {
      let capabilities = await this.deps.merchantCapabilities.findByTenantRef(input.tenantRef, tx);
      if (capabilities === null) {
        capabilities = MerchantCapabilities.create(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          input.tenantRef,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      }
      capabilities.grant(
        input.featureKey,
        input.enabled,
        input.source,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
        input.expiresAt,
        input.reason,
        input.notes,
      );
      await this.deps.merchantCapabilities.save(capabilities, tx);
      return ok({ id: capabilities.id.toString() });
    });
  }
}

export interface RevokeMerchantCapabilityInput {
  readonly tenantRef: string;
  readonly featureKey: string;
}

/** Revokes a merchant capability grant. */
export class RevokeMerchantCapability implements UseCase<
  RevokeMerchantCapabilityInput,
  IdOutput,
  DomainError
> {
  private readonly deps: LicensingDeps;

  constructor(deps: LicensingDeps) {
    this.deps = deps;
  }

  async execute(input: RevokeMerchantCapabilityInput): Promise<Result<IdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IdOutput, DomainError>>(async (tx) => {
      const capabilities = await this.deps.merchantCapabilities.findByTenantRef(
        input.tenantRef,
        tx,
      );
      if (capabilities === null) return err(new NotFoundError("Merchant capabilities not found"));
      capabilities.revoke(
        input.featureKey,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.merchantCapabilities.save(capabilities, tx);
      return ok({ id: capabilities.id.toString() });
    });
  }
}

export interface RecordUsageInput {
  readonly recordId: string;
  readonly tenantRef: string;
  readonly resource: string;
  readonly amount: number;
  readonly unit: string;
  readonly occurredAt: Date;
}

export interface RecordUsageOutput extends IdOutput {
  readonly duplicate: boolean;
}

/** Consumes one `platform.usage.recorded` record into a `UsageCounter` — replay-safe by `recordId`. */
export class RecordUsage implements UseCase<RecordUsageInput, RecordUsageOutput, DomainError> {
  private readonly deps: LicensingDeps;

  constructor(deps: LicensingDeps) {
    this.deps = deps;
  }

  async execute(input: RecordUsageInput): Promise<Result<RecordUsageOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<RecordUsageOutput, DomainError>>(async (tx) => {
      const alreadyProcessed = await this.deps.processedUsageRecords.hasProcessed(input.recordId);
      let counter = await this.deps.usageCounters.findByTenantRefAndResource(
        input.tenantRef,
        input.resource,
        tx,
      );
      if (counter === null) {
        counter = UsageCounter.create(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          input.tenantRef,
          input.resource,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      }
      if (alreadyProcessed) {
        return ok({ id: counter.id.toString(), duplicate: true });
      }
      counter.recordUsage(
        input.amount,
        input.unit,
        input.occurredAt,
        this.deps.idGenerator.generate(),
      );
      await this.deps.usageCounters.save(counter, tx);
      await this.deps.processedUsageRecords.markProcessed(input.recordId);
      return ok({ id: counter.id.toString(), duplicate: false });
    });
  }
}

export interface GetUsageCounterInput {
  readonly tenantRef: string;
  readonly resource: string;
}

export interface GetUsageCounterOutput {
  readonly amount: number;
  readonly unit: string;
}

/** Reads a tenant's current usage for one resource. */
export class GetUsageCounter implements UseCase<
  GetUsageCounterInput,
  GetUsageCounterOutput,
  DomainError
> {
  private readonly deps: LicensingDeps;

  constructor(deps: LicensingDeps) {
    this.deps = deps;
  }

  async execute(input: GetUsageCounterInput): Promise<Result<GetUsageCounterOutput, DomainError>> {
    const counter = await this.deps.usageCounters.findByTenantRefAndResource(
      input.tenantRef,
      input.resource,
    );
    if (counter === null) return ok({ amount: 0, unit: "" });
    return ok({ amount: counter.amount, unit: counter.unit });
  }
}
