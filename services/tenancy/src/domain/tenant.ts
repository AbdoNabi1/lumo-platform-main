import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { TenancyChanged } from "./events/tenancy-changed.event";
import type { TenantSlug } from "./value-objects/tenant-slug";

export type TenantStatus = "active" | "suspended" | "cancelled";
export type TenantIsolationTier = "pooled" | "dedicated_schema" | "dedicated_db";

const TRANSITIONS: Record<TenantStatus, readonly TenantStatus[]> = {
  active: ["suspended", "cancelled"],
  suspended: ["active", "cancelled"],
  cancelled: [],
};

interface TenantProps {
  readonly slug: TenantSlug;
  name: string;
  status: TenantStatus;
  isolationTier: TenantIsolationTier;
  branding: Readonly<Record<string, string>>;
  subscriptionRef?: string;
}

/**
 * The merchant account/store identity (ADR-0008 Sprint-5.5 addendum) — upstream of everything.
 * `tenant.id` **is** the platform `tenantId` primitive. References the merchant's Licensing
 * `Subscription` by ref only — Licensing owns billing/entitlements (ADR-0018).
 */
export class Tenant extends AggregateRoot<TenantProps> {
  static create(
    id: UniqueEntityId,
    slug: TenantSlug,
    name: string,
    isolationTier: TenantIsolationTier,
    eventId: string,
    occurredAt: Date,
  ): Tenant {
    const tenant = new Tenant({ slug, name, status: "active", isolationTier, branding: {} }, id);
    tenant.raise("created", eventId, occurredAt);
    return tenant;
  }

  static reconstitute(
    id: UniqueEntityId,
    slug: TenantSlug,
    name: string,
    status: TenantStatus,
    isolationTier: TenantIsolationTier,
    branding: Readonly<Record<string, string>>,
    version: number,
    subscriptionRef?: string,
  ): Tenant {
    return new Tenant(
      { slug, name, status, isolationTier, branding, subscriptionRef },
      id,
      version,
    );
  }

  activate(eventId: string, occurredAt: Date): void {
    this.transition("active", eventId, occurredAt, "activated");
  }

  suspend(eventId: string, occurredAt: Date): void {
    this.transition("suspended", eventId, occurredAt, "suspended");
  }

  cancel(eventId: string, occurredAt: Date): void {
    this.transition("cancelled", eventId, occurredAt, "cancelled");
  }

  rebrand(branding: Readonly<Record<string, string>>, eventId: string, occurredAt: Date): void {
    this.props.branding = { ...branding };
    this.raise("rebranded", eventId, occurredAt);
  }

  pinSubscription(subscriptionRef: string): void {
    this.props.subscriptionRef = subscriptionRef;
  }

  private transition(to: TenantStatus, eventId: string, occurredAt: Date, action: string): void {
    if (!TRANSITIONS[this.props.status].includes(to)) {
      throw new BusinessRuleError(`Cannot transition tenant from ${this.props.status} to ${to}`);
    }
    this.props.status = to;
    this.raise(action, eventId, occurredAt);
  }

  private raise(action: string, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new TenancyChanged(
        { eventId, aggregateId: this.id, occurredAt },
        { ref: this.props.slug.value, family: "tenant", action },
      ),
    );
  }

  get slug(): TenantSlug {
    return this.props.slug;
  }

  get name(): string {
    return this.props.name;
  }

  get status(): TenantStatus {
    return this.props.status;
  }

  get isolationTier(): TenantIsolationTier {
    return this.props.isolationTier;
  }

  get branding(): Readonly<Record<string, string>> {
    return this.props.branding;
  }

  get subscriptionRef(): string | undefined {
    return this.props.subscriptionRef;
  }
}
