import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError } from "@platform/utils";
import type { ComplianceControl, ControlSeverity } from "../domain/compliance-engine";
import type { PolicyExpression, PolicyFragment } from "../domain/policy-expression";
import type { ComplianceFramework } from "../domain/value-objects/compliance";
import type { MfaMethodKind } from "../domain/value-objects/auth-method";
import { securityEvent, type SecurityDeps } from "./deps";

export interface RegistryEntryOutput {
  readonly key: string;
  readonly version: number;
}

async function announce(
  deps: SecurityDeps,
  tenantId: string,
  registry: string,
  key: string,
  version: number,
): Promise<void> {
  await deps.outbox.publish(
    [
      securityEvent(
        deps,
        "registry",
        deps.idGenerator.generate(),
        `${registry}:${key}`,
        "security.registry.updated",
        `v${version}`,
      ),
    ],
    tenantId,
  );
}

export interface RegisterPolicyFragmentInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly key: string;
  readonly description?: string;
  readonly expression: PolicyExpression;
}

/** Registers a reusable, versioned policy fragment in the Registry Engine (sprint P2.0-D §8/§6). */
export class RegisterPolicyFragment implements UseCase<
  RegisterPolicyFragmentInput,
  RegistryEntryOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(
    input: RegisterPolicyFragmentInput,
  ): Promise<Result<RegistryEntryOutput, DomainError>> {
    const value: PolicyFragment = {
      key: input.key,
      expression: input.expression,
      ...(input.description !== undefined ? { description: input.description } : {}),
    };
    const entry = this.deps.policyFragments.register({ key: input.key, value });
    if (!entry.ok) return err(entry.error);
    await announce(this.deps, input.tenantId, "policy-fragment", input.key, entry.value.version);
    return ok({ key: input.key, version: entry.value.version });
  }
}

export interface RegisterMfaMethodInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly kind: MfaMethodKind;
  readonly displayName: string;
  readonly enabled?: boolean;
}

/** Registers/updates an MFA method definition (versioned) — sprint P2.0-D §6. */
export class RegisterMfaMethod implements UseCase<
  RegisterMfaMethodInput,
  RegistryEntryOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: RegisterMfaMethodInput): Promise<Result<RegistryEntryOutput, DomainError>> {
    const entry = this.deps.mfaMethodRegistry.register({
      key: input.kind,
      value: { kind: input.kind, displayName: input.displayName, enabled: input.enabled ?? true },
    });
    if (!entry.ok) return err(entry.error);
    await announce(this.deps, input.tenantId, "mfa-method", input.kind, entry.value.version);
    return ok({ key: input.kind, version: entry.value.version });
  }
}

export interface RegisterPermissionInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly permission: string;
  readonly description: string;
}

/** Registers a permission definition into the discoverable, versioned catalog — sprint P2.0-D §6. */
export class RegisterPermission implements UseCase<
  RegisterPermissionInput,
  RegistryEntryOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: RegisterPermissionInput): Promise<Result<RegistryEntryOutput, DomainError>> {
    const entry = this.deps.permissionRegistry.register({
      key: input.permission,
      value: { permission: input.permission, description: input.description },
    });
    if (!entry.ok) return err(entry.error);
    await announce(this.deps, input.tenantId, "permission", input.permission, entry.value.version);
    return ok({ key: input.permission, version: entry.value.version });
  }
}

export interface RegisterComplianceRuleInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly id: string;
  readonly framework: ComplianceFramework;
  readonly description: string;
  readonly severity: ControlSeverity;
}

/** Registers a compliance control into the versioned catalog — sprint P2.0-D §6/§9. */
export class RegisterComplianceRule implements UseCase<
  RegisterComplianceRuleInput,
  RegistryEntryOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(
    input: RegisterComplianceRuleInput,
  ): Promise<Result<RegistryEntryOutput, DomainError>> {
    const control: ComplianceControl = {
      id: input.id,
      framework: input.framework,
      description: input.description,
      severity: input.severity,
    };
    const entry = this.deps.complianceControlRegistry.register({
      key: input.id,
      value: control,
      tags: [input.framework],
    });
    if (!entry.ok) return err(entry.error);
    await announce(this.deps, input.tenantId, "compliance-rule", input.id, entry.value.version);
    return ok({ key: input.id, version: entry.value.version });
  }
}
