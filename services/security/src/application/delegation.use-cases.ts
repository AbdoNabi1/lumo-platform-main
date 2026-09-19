import type { UseCase } from "@platform/application";
import { isDomainError, UniqueEntityId } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, BusinessRuleError, NotFoundError } from "@platform/utils";
import { Delegation } from "../domain/delegation";
import { Session } from "../domain/session";
import type { SecurityScopeProps } from "../domain/value-objects/security-scope";
import { recordAudit, type SecurityDeps } from "./deps";

export interface DelegationOutput {
  readonly id: string;
  readonly delegatorRef: string;
  readonly delegateRef: string;
  readonly status: string;
  readonly scope: string;
  readonly expiresAt: string | null;
}

function present(d: Delegation): DelegationOutput {
  return {
    id: d.id.toString(),
    delegatorRef: d.delegatorRef,
    delegateRef: d.delegateRef,
    status: d.status,
    scope: d.scope.key(),
    expiresAt: d.expiresAt === null ? null : d.expiresAt.toISOString(),
  };
}

export interface GrantDelegationInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly delegatorExternalId: string;
  readonly delegateExternalId: string;
  readonly scope?: SecurityScopeProps;
  readonly permissions?: readonly string[];
  readonly ttlSeconds?: number;
  readonly reason?: string;
}

/** Grants a delegation (one principal may act as another, time-boxed). Emits `security.delegation.granted`. */
export class GrantDelegation implements UseCase<
  GrantDelegationInput,
  DelegationOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: GrantDelegationInput): Promise<Result<DelegationOutput, DomainError>> {
    const delegator = await this.deps.principals.findByExternalId(
      input.delegatorExternalId,
      input.tenantId,
    );
    if (delegator === null) return err(new NotFoundError("Delegator principal not found"));
    const delegate = await this.deps.principals.findByExternalId(
      input.delegateExternalId,
      input.tenantId,
    );
    if (delegate === null) return err(new NotFoundError("Delegate principal not found"));
    return this.deps.unitOfWork.run<Result<DelegationOutput, DomainError>>(async (tx) => {
      const now = this.deps.clock.now();
      const expiresAt =
        input.ttlSeconds !== undefined ? new Date(now.getTime() + input.ttlSeconds * 1000) : null;
      let delegation: Delegation;
      try {
        delegation = Delegation.grant(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          {
            delegatorRef: delegator.id.toString(),
            delegateRef: delegate.id.toString(),
            scope: input.scope,
            permissions: input.permissions,
            expiresAt,
            reason: input.reason ?? null,
          },
          this.deps.idGenerator.generate(),
          now,
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.delegations.save(delegation, input.tenantId, tx);
      await recordAudit(this.deps, tx, {
        tenantId: input.tenantId,
        principalRef: delegate.externalId,
        action: "security.delegation.granted",
        decision: "allow",
        metadata: { delegator: delegator.externalId },
      });
      return ok(present(delegation));
    });
  }
}

export interface RevokeDelegationInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly delegationId: string;
}

/** Revokes a delegation. Emits `security.delegation.revoked` + audit. */
export class RevokeDelegation implements UseCase<
  RevokeDelegationInput,
  DelegationOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: RevokeDelegationInput): Promise<Result<DelegationOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<DelegationOutput, DomainError>>(async (tx) => {
      const delegation = await this.deps.delegations.findById(
        input.delegationId,
        input.tenantId,
        tx,
      );
      if (delegation === null) return err(new NotFoundError("Delegation not found"));
      delegation.revoke(this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.delegations.save(delegation, input.tenantId, tx);
      await recordAudit(this.deps, tx, {
        tenantId: input.tenantId,
        principalRef: delegation.delegateRef,
        action: "security.delegation.revoked",
        decision: "allow",
      });
      return ok(present(delegation));
    });
  }
}

export interface StartImpersonationInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly delegationId: string;
  readonly refreshFingerprint: string;
  readonly ttlSeconds: number;
}

export interface ImpersonationOutput {
  readonly sessionId: string;
  readonly actingAs: string;
  readonly impersonatedBy: string;
  readonly expiresAt: string;
}

/**
 * Starts an **impersonation** session under an active delegation: the delegate acts as the
 * delegator. The session carries `impersonatedBy` + `delegationRef` and is WORM-audited — the
 * foundation for support/admin act-as flows (ADR-0023, sprint Part 1/delegation).
 */
export class StartImpersonation implements UseCase<
  StartImpersonationInput,
  ImpersonationOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: StartImpersonationInput): Promise<Result<ImpersonationOutput, DomainError>> {
    const delegation = await this.deps.delegations.findById(input.delegationId, input.tenantId);
    if (delegation === null) return err(new NotFoundError("Delegation not found"));
    const now = this.deps.clock.now();
    if (!delegation.isActiveAt(now)) return err(new BusinessRuleError("Delegation is not active"));
    return this.deps.unitOfWork.run<Result<ImpersonationOutput, DomainError>>(async (tx) => {
      const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);
      let session: Session;
      try {
        session = Session.establish(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          {
            principalRef: delegation.delegatorRef,
            refreshFingerprint: input.refreshFingerprint,
            impersonatedBy: delegation.delegateRef,
            delegationRef: delegation.id.toString(),
            expiresAt,
          },
          this.deps.idGenerator.generate(),
          now,
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.sessions.save(session, input.tenantId, tx);
      this.deps.telemetry.increment("security.session.established");
      await recordAudit(this.deps, tx, {
        tenantId: input.tenantId,
        principalRef: delegation.delegatorRef,
        action: "security.session.established",
        decision: "allow",
        metadata: { impersonatedBy: delegation.delegateRef, delegation: delegation.id.toString() },
      });
      return ok({
        sessionId: session.id.toString(),
        actingAs: delegation.delegatorRef,
        impersonatedBy: delegation.delegateRef,
        expiresAt: expiresAt.toISOString(),
      });
    });
  }
}
