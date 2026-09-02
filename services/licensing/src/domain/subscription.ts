import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { LicensingChanged } from "./events/licensing-changed.event";

export type SubscriptionStatus =
  "trial" | "active" | "grace" | "expired" | "suspended" | "cancelled";

const TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  trial: ["active", "cancelled", "expired"],
  active: ["grace", "suspended", "cancelled"],
  grace: ["active", "expired", "cancelled"],
  expired: ["active", "cancelled"],
  suspended: ["active", "cancelled"],
  cancelled: [],
};

export interface RenewalSchedule {
  readonly cycleDays: number;
  readonly nextRenewalAt: Date;
}

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly attempt: number;
}

interface SubscriptionProps {
  readonly tenantRef: string;
  planVersionRef: string;
  status: SubscriptionStatus;
  renewalSchedule?: RenewalSchedule;
  gracePeriodDays?: number;
  retryPolicy?: RetryPolicy;
  cancellationReason?: string;
  pausedUntil?: Date;
}

/**
 * A tenant's plan assignment (ADR-0018 base decision + Sprint-5.5/5.6 addenda) — pins a specific
 * **immutable** `PlanVersion` ref, never "the plan"; upgrade/downgrade re-pins explicitly.
 * Additively gains renewal schedule, grace period, retry policy, cancellation reason, pause/resume,
 * and a read-only renewal preview (Sprint-5.6 addendum §H). `Invoice`/`Credit` are unchanged;
 * Payments still collects, Finance still posts.
 */
export class Subscription extends AggregateRoot<SubscriptionProps> {
  static startTrial(
    id: UniqueEntityId,
    tenantRef: string,
    planVersionRef: string,
    eventId: string,
    occurredAt: Date,
  ): Subscription {
    const subscription = new Subscription({ tenantRef, planVersionRef, status: "trial" }, id);
    subscription.raise("started", eventId, occurredAt);
    return subscription;
  }

  static reconstitute(
    id: UniqueEntityId,
    tenantRef: string,
    planVersionRef: string,
    status: SubscriptionStatus,
    version: number,
    extra: {
      renewalSchedule?: RenewalSchedule;
      gracePeriodDays?: number;
      retryPolicy?: RetryPolicy;
      cancellationReason?: string;
      pausedUntil?: Date;
    } = {},
  ): Subscription {
    return new Subscription({ tenantRef, planVersionRef, status, ...extra }, id, version);
  }

  activate(eventId: string, occurredAt: Date): void {
    this.transition("active", eventId, occurredAt, "activated");
  }

  /** Re-pins to a different immutable `PlanVersion` ref — an explicit upgrade/downgrade. */
  repin(newPlanVersionRef: string, eventId: string, occurredAt: Date): void {
    this.props.planVersionRef = newPlanVersionRef;
    this.raise("repinned", eventId, occurredAt);
  }

  enterGrace(gracePeriodDays: number, eventId: string, occurredAt: Date): void {
    this.props.gracePeriodDays = gracePeriodDays;
    this.transition("grace", eventId, occurredAt, "entered_grace");
  }

  expire(eventId: string, occurredAt: Date): void {
    this.transition("expired", eventId, occurredAt, "expired");
  }

  suspend(eventId: string, occurredAt: Date): void {
    this.transition("suspended", eventId, occurredAt, "suspended");
  }

  cancel(reason: string, eventId: string, occurredAt: Date): void {
    this.props.cancellationReason = reason;
    this.transition("cancelled", eventId, occurredAt, "cancelled");
  }

  pause(resumeDate: Date, eventId: string, occurredAt: Date): void {
    this.props.pausedUntil = resumeDate;
    this.raise("paused", eventId, occurredAt);
  }

  resume(eventId: string, occurredAt: Date): void {
    this.props.pausedUntil = undefined;
    this.raise("resumed", eventId, occurredAt);
  }

  setRenewalSchedule(schedule: RenewalSchedule): void {
    this.props.renewalSchedule = schedule;
  }

  setRetryPolicy(policy: RetryPolicy): void {
    this.props.retryPolicy = policy;
  }

  /** Read-only projection of the next charge — does not mutate. */
  previewRenewal(): { readonly nextRenewalAt: Date | undefined; readonly planVersionRef: string } {
    return {
      nextRenewalAt: this.props.renewalSchedule?.nextRenewalAt,
      planVersionRef: this.props.planVersionRef,
    };
  }

  private transition(
    to: SubscriptionStatus,
    eventId: string,
    occurredAt: Date,
    action: string,
  ): void {
    if (!TRANSITIONS[this.props.status].includes(to)) {
      throw new BusinessRuleError(
        `Cannot transition subscription from ${this.props.status} to ${to}`,
      );
    }
    this.props.status = to;
    this.raise(action, eventId, occurredAt);
  }

  private raise(action: string, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new LicensingChanged(
        { eventId, aggregateId: this.id, occurredAt },
        { ref: this.props.tenantRef, family: "subscription", action },
      ),
    );
  }

  get tenantRef(): string {
    return this.props.tenantRef;
  }

  get planVersionRef(): string {
    return this.props.planVersionRef;
  }

  get status(): SubscriptionStatus {
    return this.props.status;
  }

  get renewalSchedule(): RenewalSchedule | undefined {
    return this.props.renewalSchedule;
  }

  get gracePeriodDays(): number | undefined {
    return this.props.gracePeriodDays;
  }

  get retryPolicy(): RetryPolicy | undefined {
    return this.props.retryPolicy;
  }

  get cancellationReason(): string | undefined {
    return this.props.cancellationReason;
  }

  get pausedUntil(): Date | undefined {
    return this.props.pausedUntil;
  }
}
