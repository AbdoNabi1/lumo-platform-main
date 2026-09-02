import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { SecurityChanged } from "./events/security-changed.event";
import type { PolicyMode } from "./policy";

/** Mirrors Tenancy's isolation tier (ADR-0008) — referenced, not owned, here. */
export const ISOLATION_TIERS = ["pooled", "dedicated_schema", "dedicated_db"] as const;
export type IsolationTier = (typeof ISOLATION_TIERS)[number];

export interface TenantSecurityConfig {
  readonly isolationTier?: IsolationTier;
  readonly residencyRegion?: string;
  readonly securityMode?: PolicyMode;
  readonly mfaRequired?: boolean;
  readonly allowedAuthMethods?: readonly string[];
  readonly defaultPolicyKey?: string | null;
}

interface TenantSecurityProfileProps {
  readonly tenantRef: string;
  isolationTier: IsolationTier;
  residencyRegion: string;
  securityMode: PolicyMode;
  mfaRequired: boolean;
  allowedAuthMethods: string[];
  defaultPolicyKey: string | null;
}

/**
 * A **tenant security profile** — the tenant's isolation + posture boundary. It *references*
 * Tenancy's isolation tier (ADR-0008) and adds data-residency region, default security mode,
 * MFA requirement, allowed auth methods, and the governing policy key. Every tenant request is
 * evaluated within its profile; this is the tenant isolation model (ADR-0023, sprint Part: tenant
 * boundaries).
 */
export class TenantSecurityProfile extends AggregateRoot<TenantSecurityProfileProps> {
  static configure(
    id: UniqueEntityId,
    tenantRef: string,
    config: TenantSecurityConfig,
    eventId: string,
    occurredAt: Date,
  ): TenantSecurityProfile {
    if (tenantRef.trim().length === 0)
      throw new BusinessRuleError("A tenant security profile needs a tenantRef");
    const profile = new TenantSecurityProfile(
      {
        tenantRef: tenantRef.trim(),
        isolationTier: config.isolationTier ?? "pooled",
        residencyRegion: (config.residencyRegion ?? "global").trim(),
        securityMode: config.securityMode ?? "balanced",
        mfaRequired: config.mfaRequired ?? false,
        allowedAuthMethods: [...(config.allowedAuthMethods ?? ["password"])],
        defaultPolicyKey: config.defaultPolicyKey ?? null,
      },
      id,
    );
    profile.emit(eventId, occurredAt);
    return profile;
  }

  static reconstitute(
    id: UniqueEntityId,
    base: TenantSecurityProfileProps & { readonly version: number },
  ): TenantSecurityProfile {
    return new TenantSecurityProfile(
      { ...base, allowedAuthMethods: [...base.allowedAuthMethods] },
      id,
      base.version,
    );
  }

  reconfigure(config: TenantSecurityConfig, eventId: string, occurredAt: Date): void {
    if (config.isolationTier !== undefined) this.props.isolationTier = config.isolationTier;
    if (config.residencyRegion !== undefined)
      this.props.residencyRegion = config.residencyRegion.trim();
    if (config.securityMode !== undefined) this.props.securityMode = config.securityMode;
    if (config.mfaRequired !== undefined) this.props.mfaRequired = config.mfaRequired;
    if (config.allowedAuthMethods !== undefined)
      this.props.allowedAuthMethods = [...config.allowedAuthMethods];
    if (config.defaultPolicyKey !== undefined)
      this.props.defaultPolicyKey = config.defaultPolicyKey;
    this.emit(eventId, occurredAt);
  }

  get tenantRef(): string {
    return this.props.tenantRef;
  }
  get isolationTier(): IsolationTier {
    return this.props.isolationTier;
  }
  get residencyRegion(): string {
    return this.props.residencyRegion;
  }
  get securityMode(): PolicyMode {
    return this.props.securityMode;
  }
  get mfaRequired(): boolean {
    return this.props.mfaRequired;
  }
  get allowedAuthMethods(): readonly string[] {
    return this.props.allowedAuthMethods;
  }
  get defaultPolicyKey(): string | null {
    return this.props.defaultPolicyKey;
  }

  private emit(eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new SecurityChanged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          aggregateId: this.id.toString(),
          aggregate: "tenant_profile",
          key: this.props.tenantRef,
          event: "security.tenant_profile.configured",
          status: this.props.securityMode,
        },
      ),
    );
  }
}
