import type { UseCase } from "@platform/application";
import { isDomainError, UniqueEntityId } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, BusinessRuleError, NotFoundError } from "@platform/utils";
import {
  MachineIdentityProfile,
  type MachineIdentityConfig,
} from "../domain/machine-identity-profile";
import { isHumanKind } from "../domain/value-objects/principal-kind";
import { recordAudit, type SecurityDeps } from "./deps";

export interface MachineIdentityOutput {
  readonly principalRef: string;
  readonly owner: string;
  readonly purpose: string;
  readonly status: string;
  readonly allowedEnvironments: readonly string[];
  readonly allowedScopes: readonly string[];
  readonly maxCredentialTtlSeconds: number | null;
  readonly rotationIntervalDays: number | null;
}

function present(p: MachineIdentityProfile): MachineIdentityOutput {
  return {
    principalRef: p.principalRef,
    owner: p.owner,
    purpose: p.purpose,
    status: p.status,
    allowedEnvironments: [...p.allowedEnvironments],
    allowedScopes: [...p.allowedScopes],
    maxCredentialTtlSeconds: p.maxCredentialTtlSeconds,
    rotationIntervalDays: p.rotationIntervalDays,
  };
}

export interface GovernMachineIdentityInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly principalExternalId: string;
  readonly config: MachineIdentityConfig;
}

/**
 * Governs a **non-human** principal independently (owner/purpose/environments/scope-ceiling/credential
 * TTL/rotation). Idempotent: first call creates the profile, later calls patch it. Rejects human
 * principals (those are governed by Identity). Emits `security.machine_identity.governed`.
 */
export class GovernMachineIdentity implements UseCase<
  GovernMachineIdentityInput,
  MachineIdentityOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(
    input: GovernMachineIdentityInput,
  ): Promise<Result<MachineIdentityOutput, DomainError>> {
    const principal = await this.deps.principals.findByExternalId(
      input.principalExternalId,
      input.tenantId,
    );
    if (principal === null) return err(new NotFoundError("Principal not found"));
    if (isHumanKind(principal.kind))
      return err(
        new BusinessRuleError("Machine identity governance applies to non-human principals only"),
      );
    return this.deps.unitOfWork.run<Result<MachineIdentityOutput, DomainError>>(async (tx) => {
      const now = this.deps.clock.now();
      const eventId = this.deps.idGenerator.generate();
      const existing = await this.deps.machineProfiles.findByPrincipal(
        principal.id.toString(),
        input.tenantId,
        tx,
      );
      let profile: MachineIdentityProfile;
      try {
        if (existing === null) {
          profile = MachineIdentityProfile.govern(
            UniqueEntityId.from(this.deps.idGenerator.generate()),
            principal.id.toString(),
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
      await this.deps.machineProfiles.save(profile, input.tenantId, tx);
      await recordAudit(this.deps, tx, {
        tenantId: input.tenantId,
        principalRef: principal.externalId,
        action: "security.machine_identity.governed",
        decision: "allow",
        tenantRef: principal.tenantRef,
        metadata: { kind: principal.kind },
      });
      return ok(present(profile));
    });
  }
}

export interface SuspendMachineIdentityInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly principalExternalId: string;
}

/** Suspends a machine identity (kill-switch). Emits `security.machine_identity.suspended` + audit. */
export class SuspendMachineIdentity implements UseCase<
  SuspendMachineIdentityInput,
  MachineIdentityOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(
    input: SuspendMachineIdentityInput,
  ): Promise<Result<MachineIdentityOutput, DomainError>> {
    const principal = await this.deps.principals.findByExternalId(
      input.principalExternalId,
      input.tenantId,
    );
    if (principal === null) return err(new NotFoundError("Principal not found"));
    return this.deps.unitOfWork.run<Result<MachineIdentityOutput, DomainError>>(async (tx) => {
      const profile = await this.deps.machineProfiles.findByPrincipal(
        principal.id.toString(),
        input.tenantId,
        tx,
      );
      if (profile === null) return err(new NotFoundError("Machine identity profile not found"));
      profile.suspend(this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.machineProfiles.save(profile, input.tenantId, tx);
      await recordAudit(this.deps, tx, {
        tenantId: input.tenantId,
        principalRef: principal.externalId,
        action: "security.machine_identity.suspended",
        decision: "allow",
        tenantRef: principal.tenantRef,
      });
      return ok(present(profile));
    });
  }
}
