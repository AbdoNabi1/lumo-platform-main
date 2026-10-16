import type { UseCase } from "@platform/application";
import { isDomainError, UniqueEntityId } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, BusinessRuleError, NotFoundError } from "@platform/utils";
import { AiGovernanceProfile, type AiGovernanceConfig } from "../domain/ai-governance-profile";
import { recordAudit, type SecurityDeps } from "./deps";

export interface AiGovernanceOutput {
  readonly principalRef: string;
  readonly status: string;
  readonly tokenBudget: number | null;
  readonly callQuota: number | null;
  readonly tokensConsumed: number;
  readonly callsConsumed: number;
  readonly isolationLevel: string;
  readonly allowedTools: readonly string[];
  readonly allowedResources: readonly string[];
}

function present(p: AiGovernanceProfile): AiGovernanceOutput {
  return {
    principalRef: p.principalRef,
    status: p.status,
    tokenBudget: p.tokenBudget,
    callQuota: p.callQuota,
    tokensConsumed: p.tokensConsumed,
    callsConsumed: p.callsConsumed,
    isolationLevel: p.isolationLevel,
    allowedTools: [...p.allowedTools],
    allowedResources: [...p.allowedResources],
  };
}

export interface GovernAiIdentityInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly principalExternalId: string;
  readonly config: AiGovernanceConfig;
}

/**
 * Governs an **AI** principal (budgets/quotas/sandboxing/isolation) — §20. Idempotent: first call
 * creates, later calls patch. Rejects non-`ai` principals (those are governed by machine-identity /
 * identity). Emits `security.ai_identity.governed`.
 */
export class GovernAiIdentity implements UseCase<
  GovernAiIdentityInput,
  AiGovernanceOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: GovernAiIdentityInput): Promise<Result<AiGovernanceOutput, DomainError>> {
    const principal = await this.deps.principals.findByExternalId(
      input.principalExternalId,
      input.tenantId,
    );
    if (principal === null) return err(new NotFoundError("Principal not found"));
    if (principal.kind !== "ai")
      return err(new BusinessRuleError("AI governance applies to ai-kind principals only"));
    return this.deps.unitOfWork.run<Result<AiGovernanceOutput, DomainError>>(async (tx) => {
      const now = this.deps.clock.now();
      const eventId = this.deps.idGenerator.generate();
      const existing = await this.deps.aiProfiles.findByPrincipal(
        principal.id.toString(),
        input.tenantId,
        tx,
      );
      let profile: AiGovernanceProfile;
      try {
        if (existing === null) {
          profile = AiGovernanceProfile.govern(
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
      await this.deps.aiProfiles.save(profile, input.tenantId, tx);
      await recordAudit(this.deps, tx, {
        tenantId: input.tenantId,
        principalRef: principal.externalId,
        action: "security.ai_identity.governed",
        decision: "allow",
        tenantRef: principal.tenantRef,
        metadata: { isolation: profile.isolationLevel },
      });
      return ok(present(profile));
    });
  }
}

export interface SuspendAiIdentityInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly principalExternalId: string;
}

/** Suspends an AI identity (kill-switch). Emits `security.ai_identity.suspended` + audit. */
export class SuspendAiIdentity implements UseCase<
  SuspendAiIdentityInput,
  AiGovernanceOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: SuspendAiIdentityInput): Promise<Result<AiGovernanceOutput, DomainError>> {
    const principal = await this.deps.principals.findByExternalId(
      input.principalExternalId,
      input.tenantId,
    );
    if (principal === null) return err(new NotFoundError("Principal not found"));
    return this.deps.unitOfWork.run<Result<AiGovernanceOutput, DomainError>>(async (tx) => {
      const profile = await this.deps.aiProfiles.findByPrincipal(
        principal.id.toString(),
        input.tenantId,
        tx,
      );
      if (profile === null) return err(new NotFoundError("AI governance profile not found"));
      profile.suspend(this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.aiProfiles.save(profile, input.tenantId, tx);
      await recordAudit(this.deps, tx, {
        tenantId: input.tenantId,
        principalRef: principal.externalId,
        action: "security.ai_identity.suspended",
        decision: "allow",
        tenantRef: principal.tenantRef,
      });
      return ok(present(profile));
    });
  }
}

export interface CheckAiActionInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly principalExternalId: string;
  readonly tool?: string;
  readonly resource?: string;
  readonly tokens?: number;
  readonly calls?: number;
}

export interface AiActionDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly remainingTokens: number | null;
  readonly remainingCalls: number | null;
}

/**
 * The AI action gate (§20) — checks sandboxing (allowed tool), isolation (allowed resource) and
 * budget/quota in one call, recording consumption when allowed. A denial is a recorded fact
 * (over-budget emits `security.ai_identity.budget_exceeded`); every check is WORM-audited.
 */
export class CheckAiAction implements UseCase<CheckAiActionInput, AiActionDecision, DomainError> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: CheckAiActionInput): Promise<Result<AiActionDecision, DomainError>> {
    const principal = await this.deps.principals.findByExternalId(
      input.principalExternalId,
      input.tenantId,
    );
    if (principal === null) return err(new NotFoundError("Principal not found"));
    return this.deps.unitOfWork.run<Result<AiActionDecision, DomainError>>(async (tx) => {
      const profile = await this.deps.aiProfiles.findByPrincipal(
        principal.id.toString(),
        input.tenantId,
        tx,
      );
      if (profile === null) return err(new NotFoundError("AI governance profile not found"));

      if (input.tool !== undefined && !profile.permitsTool(input.tool)) {
        return this.deny(
          tx,
          input.tenantId,
          principal.externalId,
          principal.tenantRef,
          `tool "${input.tool}" not permitted (sandbox)`,
        );
      }
      if (input.resource !== undefined && !profile.permitsResource(input.resource)) {
        return this.deny(
          tx,
          input.tenantId,
          principal.externalId,
          principal.tenantRef,
          `resource "${input.resource}" not permitted (isolation)`,
        );
      }
      const decision = profile.consume(
        input.tokens ?? 0,
        input.calls ?? 0,
        this.deps.clock.now(),
        this.deps.idGenerator.generate(),
      );
      await this.deps.aiProfiles.save(profile, input.tenantId, tx);
      await recordAudit(this.deps, tx, {
        tenantId: input.tenantId,
        principalRef: principal.externalId,
        action: "security.ai.action_checked",
        decision: decision.allowed ? "allow" : "deny",
        tenantRef: principal.tenantRef,
        metadata: {
          tool: input.tool ?? "-",
          allowed: String(decision.allowed),
          ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
        },
      });
      return ok(decision);
    });
  }

  private async deny(
    tx: unknown,
    tenantId: string,
    principalRef: string,
    tenantRef: string | null,
    reason: string,
  ): Promise<Result<AiActionDecision, DomainError>> {
    await recordAudit(this.deps, tx, {
      tenantId,
      principalRef,
      action: "security.ai.action_checked",
      decision: "deny",
      tenantRef,
      metadata: { reason },
    });
    return ok({ allowed: false, reason, remainingTokens: null, remainingCalls: null });
  }
}
