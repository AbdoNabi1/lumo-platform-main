import type { UseCase } from "@platform/application";
import { isDomainError, UniqueEntityId } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { type DomainError } from "@platform/utils";
import {
  TenantSecurityProfile,
  type TenantSecurityConfig,
} from "../domain/tenant-security-profile";
import { recordAudit, type SecurityDeps } from "./deps";

export interface TenantSecurityProfileOutput {
  readonly id: string;
  readonly tenantRef: string;
  readonly isolationTier: string;
  readonly residencyRegion: string;
  readonly securityMode: string;
  readonly mfaRequired: boolean;
  readonly allowedAuthMethods: readonly string[];
  readonly defaultPolicyKey: string | null;
}

function present(p: TenantSecurityProfile): TenantSecurityProfileOutput {
  return {
    id: p.id.toString(),
    tenantRef: p.tenantRef,
    isolationTier: p.isolationTier,
    residencyRegion: p.residencyRegion,
    securityMode: p.securityMode,
    mfaRequired: p.mfaRequired,
    allowedAuthMethods: [...p.allowedAuthMethods],
    defaultPolicyKey: p.defaultPolicyKey,
  };
}

export interface ConfigureTenantSecurityInput {
  readonly tenantRef: string;
  readonly config: TenantSecurityConfig;
}

/**
 * Configures (or reconfigures) a tenant's security profile — the tenant isolation/posture boundary.
 * Idempotent: first call creates, later calls patch. Emits `security.tenant_profile.configured` + audit.
 */
export class ConfigureTenantSecurity implements UseCase<
  ConfigureTenantSecurityInput,
  TenantSecurityProfileOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(
    input: ConfigureTenantSecurityInput,
  ): Promise<Result<TenantSecurityProfileOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<TenantSecurityProfileOutput, DomainError>>(
      async (tx) => {
        const now = this.deps.clock.now();
        const eventId = this.deps.idGenerator.generate();
        const existing = await this.deps.tenantProfiles.findByTenant(input.tenantRef, tx);
        let profile: TenantSecurityProfile;
        try {
          if (existing === null) {
            profile = TenantSecurityProfile.configure(
              UniqueEntityId.from(this.deps.idGenerator.generate()),
              input.tenantRef,
              input.config,
              eventId,
              now,
            );
          } else {
            existing.reconfigure(input.config, eventId, now);
            profile = existing;
          }
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }
        await this.deps.tenantProfiles.save(profile, tx);
        await recordAudit(this.deps, tx, {
          principalRef: "system",
          action: "security.tenant_profile.configured",
          decision: "allow",
          tenantRef: input.tenantRef,
          metadata: { mode: profile.securityMode },
        });
        return ok(present(profile));
      },
    );
  }
}
