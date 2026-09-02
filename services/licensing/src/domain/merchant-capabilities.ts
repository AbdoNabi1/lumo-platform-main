import { AggregateRoot, type UniqueEntityId } from "@platform/domain";
import { LicensingChanged } from "./events/licensing-changed.event";

export type CapabilityGrantSource =
  "manual" | "temporary" | "trial" | "beta" | "enterprise" | "sales" | "support";

export interface CapabilityGrant {
  readonly featureKey: string;
  readonly enabled: boolean;
  readonly source: CapabilityGrantSource;
  readonly expiresAt?: Date;
  readonly reason?: string;
  readonly notes?: string;
}

export interface CapabilityAuditEntry {
  readonly featureKey: string;
  readonly action: "granted" | "revoked";
  readonly source: CapabilityGrantSource;
  readonly at: Date;
  readonly eventId: string;
}

interface MerchantCapabilitiesProps {
  readonly tenantRef: string;
  grants: Map<string, CapabilityGrant>;
  auditHistory: CapabilityAuditEntry[];
}

/**
 * The go-forward operational override layer (ADR-0018 Sprint-5.6 addendum §F) — a dedicated
 * per-tenant×feature grant with provenance, expiration, reason, notes, and an append-only audit
 * history. Subscriptions keep only commercial entitlements; `CheckEntitlement` reads this first,
 * falling back to the legacy `MerchantFeatureOverride`.
 */
export class MerchantCapabilities extends AggregateRoot<MerchantCapabilitiesProps> {
  static create(
    id: UniqueEntityId,
    tenantRef: string,
    eventId: string,
    occurredAt: Date,
  ): MerchantCapabilities {
    const capabilities = new MerchantCapabilities(
      { tenantRef, grants: new Map(), auditHistory: [] },
      id,
    );
    capabilities.raise("created", eventId, occurredAt, tenantRef);
    return capabilities;
  }

  static reconstitute(
    id: UniqueEntityId,
    tenantRef: string,
    grants: readonly CapabilityGrant[],
    auditHistory: readonly CapabilityAuditEntry[],
    version: number,
  ): MerchantCapabilities {
    const grantMap = new Map(grants.map((grant) => [grant.featureKey, grant]));
    return new MerchantCapabilities(
      { tenantRef, grants: grantMap, auditHistory: [...auditHistory] },
      id,
      version,
    );
  }

  grant(
    featureKey: string,
    enabled: boolean,
    source: CapabilityGrantSource,
    eventId: string,
    occurredAt: Date,
    expiresAt?: Date,
    reason?: string,
    notes?: string,
  ): void {
    this.props.grants.set(featureKey, { featureKey, enabled, source, expiresAt, reason, notes });
    this.props.auditHistory.push({
      featureKey,
      action: "granted",
      source,
      at: occurredAt,
      eventId,
    });
    this.raise("granted", eventId, occurredAt, featureKey);
  }

  revoke(featureKey: string, eventId: string, occurredAt: Date): void {
    const existing = this.props.grants.get(featureKey);
    this.props.grants.delete(featureKey);
    this.props.auditHistory.push({
      featureKey,
      action: "revoked",
      source: existing?.source ?? "manual",
      at: occurredAt,
      eventId,
    });
    this.raise("revoked", eventId, occurredAt, featureKey);
  }

  /** Resolves the effective grant for a feature, honoring `expiresAt`. */
  resolve(featureKey: string, now: Date): CapabilityGrant | undefined {
    const grant = this.props.grants.get(featureKey);
    if (grant === undefined) return undefined;
    if (grant.expiresAt !== undefined && grant.expiresAt.getTime() <= now.getTime())
      return undefined;
    return grant;
  }

  private raise(action: string, eventId: string, occurredAt: Date, ref: string): void {
    this.addDomainEvent(
      new LicensingChanged(
        { eventId, aggregateId: this.id, occurredAt },
        { ref: `${this.props.tenantRef}:${ref}`, family: "merchant_capabilities", action },
      ),
    );
  }

  get tenantRef(): string {
    return this.props.tenantRef;
  }

  get grants(): readonly CapabilityGrant[] {
    return [...this.props.grants.values()];
  }

  get auditHistory(): readonly CapabilityAuditEntry[] {
    return this.props.auditHistory;
  }
}
