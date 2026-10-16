import type { UseCase } from "@platform/application";
import { isDomainError, UniqueEntityId } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import { Policy, type PolicyEffect, type PolicyMode, type PolicyRule } from "../domain/policy";
import { ResourceUrn } from "../domain/value-objects/resource-urn";
import type { ZeroTrustDecision } from "../domain/zero-trust";
import { recordAudit, type SecurityDeps } from "./deps";

export interface PolicyOutput {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly mode: string;
  readonly status: string;
  readonly activeVersion: number | null;
  readonly versionCount: number;
}

function present(p: Policy): PolicyOutput {
  return {
    id: p.id.toString(),
    key: p.key,
    name: p.name,
    mode: p.mode,
    status: p.status,
    activeVersion: p.activeVersionNumber,
    versionCount: p.versions.length,
  };
}

export interface DefinePolicyInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly key: string;
  readonly name: string;
  readonly mode: PolicyMode;
}

/** Defines a policy in the Policy Registry (idempotent per key; starts in `draft`). */
export class DefinePolicy implements UseCase<DefinePolicyInput, PolicyOutput, DomainError> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: DefinePolicyInput): Promise<Result<PolicyOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<PolicyOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.policies.findByKey(input.key, input.tenantId, tx);
      if (existing !== null) return ok(present(existing));
      let policy: Policy;
      try {
        policy = Policy.define(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          input,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.policies.save(policy, input.tenantId, tx);
      await recordAudit(this.deps, tx, {
        tenantId: input.tenantId,
        principalRef: "system",
        action: "security.policy.defined",
        decision: "allow",
        metadata: { policy: policy.key },
      });
      return ok(present(policy));
    });
  }
}

export interface PublishPolicyVersionInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly key: string;
  readonly rules: readonly PolicyRule[];
  readonly defaultEffect?: PolicyEffect;
}

/** Publishes a new immutable policy version and activates it. Emits `security.policy.version_published`. */
export class PublishPolicyVersion implements UseCase<
  PublishPolicyVersionInput,
  PolicyOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: PublishPolicyVersionInput): Promise<Result<PolicyOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<PolicyOutput, DomainError>>(async (tx) => {
      const policy = await this.deps.policies.findByKey(input.key, input.tenantId, tx);
      if (policy === null) return err(new NotFoundError("Policy not found"));
      try {
        policy.publishVersion(
          { rules: input.rules, defaultEffect: input.defaultEffect },
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.policies.save(policy, input.tenantId, tx);
      await recordAudit(this.deps, tx, {
        tenantId: input.tenantId,
        principalRef: "system",
        action: "security.policy.version_published",
        decision: "allow",
        metadata: { policy: policy.key, version: String(policy.activeVersionNumber) },
      });
      return ok(present(policy));
    });
  }
}

export interface ArchivePolicyInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly key: string;
}

/** Archives a policy. Emits `security.policy.archived` + audit. */
export class ArchivePolicy implements UseCase<ArchivePolicyInput, PolicyOutput, DomainError> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: ArchivePolicyInput): Promise<Result<PolicyOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<PolicyOutput, DomainError>>(async (tx) => {
      const policy = await this.deps.policies.findByKey(input.key, input.tenantId, tx);
      if (policy === null) return err(new NotFoundError("Policy not found"));
      policy.archive(this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.policies.save(policy, input.tenantId, tx);
      await recordAudit(this.deps, tx, {
        tenantId: input.tenantId,
        principalRef: "system",
        action: "security.policy.archived",
        decision: "allow",
        metadata: { policy: policy.key },
      });
      return ok(present(policy));
    });
  }
}

export interface SimulatePolicyInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly key: string;
  readonly context: {
    readonly principalActive?: boolean;
    readonly sessionValid?: boolean;
    readonly permissionGranted?: boolean;
    readonly deviceTrusted?: boolean;
    readonly risk?: number;
    readonly trust?: number;
    readonly environment?: string | null;
    readonly resource?: string | null;
  };
}

/**
 * **Policy simulation + explanation + trace** (Part 3) — evaluates the policy's active version
 * against a hypothetical context and returns the decision with the matched rule ids and reasons.
 * Pure, read-only: no persistence, no audit — a what-if against real policy data.
 */
export class SimulatePolicy implements UseCase<
  SimulatePolicyInput,
  ZeroTrustDecision,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: SimulatePolicyInput): Promise<Result<ZeroTrustDecision, DomainError>> {
    const policy = await this.deps.policies.findByKey(input.key, input.tenantId);
    if (policy === null) return err(new NotFoundError("Policy not found"));
    const c = input.context;
    let resource: ResourceUrn | null = null;
    if (c.resource != null) {
      const parsed = ResourceUrn.parse(c.resource);
      if (parsed.ok) resource = parsed.value;
    }
    const decision = this.deps.zeroTrust.evaluate(
      {
        principalActive: c.principalActive ?? true,
        sessionValid: c.sessionValid ?? true,
        permissionGranted: c.permissionGranted ?? true,
        deviceTrusted: c.deviceTrusted ?? false,
        risk: c.risk ?? 0,
        trust: c.trust ?? 0,
        environment: c.environment ?? null,
        resource,
      },
      policy.activePolicyVersion(),
      this.deps.fragmentResolver,
    );
    return ok(decision);
  }
}
