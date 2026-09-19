import type { UseCase } from "@platform/application";
import { UniqueEntityId } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, BusinessRuleError } from "@platform/utils";
import { Device } from "../domain/device";
import { Session } from "../domain/session";
import type { MfaRequirement } from "../domain/value-objects/auth-method";
import { type AuthMethodKind, type AuthMethodSpec } from "../domain/value-objects/auth-method";
import type { RiskBand } from "../domain/value-objects/scores";
import { recordAudit, securityEvent, type SecurityDeps } from "./deps";
import { enrichRiskSignals } from "./risk-helpers";

export interface RegisterAuthMethodInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly kind: AuthMethodKind;
  readonly displayName: string;
  readonly enabled?: boolean;
  readonly config?: Readonly<Record<string, string>>;
}

export interface AuthMethodOutput {
  readonly kind: string;
  readonly version: number;
  readonly enabled: boolean;
  readonly displayName: string;
}

/**
 * Registers/updates an authentication method in the versioned Registry Engine (`packages/registry`,
 * sprint P2.0-B §1/§6). Configuration only — verification is the provider plugin's job. Emits
 * `security.auth_method.registered`.
 */
export class RegisterAuthMethod implements UseCase<
  RegisterAuthMethodInput,
  AuthMethodOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: RegisterAuthMethodInput): Promise<Result<AuthMethodOutput, DomainError>> {
    const spec: AuthMethodSpec = {
      kind: input.kind,
      enabled: input.enabled ?? true,
      displayName: input.displayName,
      ...(input.config !== undefined ? { config: input.config } : {}),
    };
    const registered = this.deps.authMethodRegistry.register({
      key: input.kind,
      value: spec,
      tags: [spec.enabled ? "enabled" : "disabled"],
    });
    if (!registered.ok) return err(registered.error);
    await this.deps.outbox.publish(
      [
        securityEvent(
          this.deps,
          "auth_method",
          this.deps.idGenerator.generate(),
          input.kind,
          "security.auth_method.registered",
          spec.enabled ? "enabled" : "disabled",
        ),
      ],
      input.tenantId,
    );
    return ok({
      kind: input.kind,
      version: registered.value.version,
      enabled: spec.enabled,
      displayName: spec.displayName,
    });
  }
}

export interface AuthenticateInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly method: AuthMethodKind;
  readonly identifier: string;
  readonly credential?: string;
  readonly deviceFingerprint?: string;
  readonly ip?: string;
  readonly sensitiveAction?: boolean;
  readonly rememberDevice?: boolean;
  /** Set when a fresh MFA factor has already been verified in this flow (satisfies step-up/required). */
  readonly mfaSatisfied?: boolean;
  readonly sessionTtlSeconds?: number;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface AuthenticationOutcome {
  readonly authenticated: boolean;
  readonly principalExternalId: string | null;
  readonly sessionId: string | null;
  readonly mfaRequirement: MfaRequirement;
  readonly riskScore: number;
  readonly riskBand: RiskBand;
  readonly reason?: string;
}

/**
 * The **authenticate()** flow (sprint P2.0-B §1/§2/§4) — the provider-agnostic authentication entry
 * point. Verifies via the method's provider plugin, scores risk (Risk Engine + geo/device), decides
 * the MFA requirement (MFA Engine), registers/touches the device, and — when MFA is satisfied or not
 * required — establishes a session. Every outcome is WORM-audited and emits `security.auth.*`.
 * Security owns the decision; Kratos/Keto remain the enforcement points.
 */
export class Authenticate implements UseCase<
  AuthenticateInput,
  AuthenticationOutcome,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}

  async execute(input: AuthenticateInput): Promise<Result<AuthenticationOutcome, DomainError>> {
    const methodEntry = this.deps.authMethodRegistry.get(input.method);
    if (methodEntry === null || !methodEntry.value.enabled)
      return err(new BusinessRuleError(`Authentication method "${input.method}" is not enabled`));
    const provider = this.deps.authProviders.get(input.method);
    if (provider === null)
      return err(
        new BusinessRuleError(`No authentication provider registered for "${input.method}"`),
      );

    const result = await provider.authenticate({
      method: input.method,
      identifier: input.identifier,
      ...(input.credential !== undefined ? { credential: input.credential } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    });

    // Risk (enriched) — computed for both success and failure paths.
    const risk = await this.evaluateRisk(input);

    if (!result.ok || result.principalExternalId === undefined) {
      return this.fail(input, risk, result.reason ?? "authentication failed");
    }
    const principal = await this.deps.principals.findByExternalId(
      result.principalExternalId,
      input.tenantId,
    );
    if (principal === null)
      return this.fail(input, risk, "authenticated subject is not a known principal");

    // Device trust + MFA decision.
    let deviceTrusted = false;
    if (input.deviceFingerprint !== undefined) {
      const existing = await this.deps.devices.findByFingerprint(
        input.deviceFingerprint,
        input.tenantId,
      );
      deviceTrusted = existing !== null && existing.isTrusted;
    }
    const profile =
      principal.tenantRef !== null
        ? await this.deps.tenantProfiles.findByTenant(principal.tenantRef, input.tenantId)
        : null;
    const enrollments = await this.deps.mfaEnrollments.listByPrincipal(
      principal.id.toString(),
      input.tenantId,
    );
    const mfa = this.deps.mfaEngine.decide({
      tenantMfaRequired: profile?.mfaRequired ?? false,
      hasActiveEnrollment: enrollments.some((e) => e.isActive),
      deviceTrusted,
      rememberDevice: input.rememberDevice ?? false,
      riskBand: risk.band,
      sensitiveAction: input.sensitiveAction ?? false,
    });
    const mfaSatisfied =
      input.mfaSatisfied === true || mfa.requirement === "none" || mfa.requirement === "optional";

    const refreshFingerprint = await this.deps.crypto.randomToken(24);
    return this.deps.unitOfWork.run<Result<AuthenticationOutcome, DomainError>>(async (tx) => {
      await this.ensureDevice(
        input.tenantId,
        input.deviceFingerprint,
        principal.id.toString(),
        principal.tenantRef,
        tx,
      );

      let sessionId: string | null = null;
      if (mfaSatisfied) {
        const session = Session.establish(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          {
            principalRef: principal.id.toString(),
            refreshFingerprint,
            deviceRef: input.deviceFingerprint ?? null,
            riskAtLastEval: risk.score,
            expiresAt: new Date(
              this.deps.clock.now().getTime() + (input.sessionTtlSeconds ?? 3600) * 1000,
            ),
          },
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
        await this.deps.sessions.save(session, input.tenantId, tx);
        sessionId = session.id.toString();
        this.deps.telemetry.increment("security.session.established");
      }
      this.deps.telemetry.increment("security.login.succeeded");
      await this.deps.outbox.publish(
        [
          securityEvent(
            this.deps,
            "auth",
            this.deps.idGenerator.generate(),
            principal.externalId,
            "security.auth.succeeded",
            mfaSatisfied ? "session" : "mfa_pending",
          ),
        ],
        input.tenantId,
        tx,
      );
      await recordAudit(this.deps, tx, {
        tenantId: input.tenantId,
        principalRef: principal.externalId,
        action: "security.auth.succeeded",
        decision: "allow",
        tenantRef: principal.tenantRef,
        metadata: { method: input.method, risk: String(risk.score), mfa: mfa.requirement },
      });

      return ok({
        authenticated: true,
        principalExternalId: principal.externalId,
        sessionId,
        mfaRequirement: mfa.requirement,
        riskScore: risk.score,
        riskBand: risk.band,
      });
    });
  }

  private async evaluateRisk(input: AuthenticateInput): Promise<{ score: number; band: RiskBand }> {
    const signals = await enrichRiskSignals(
      this.deps,
      {
        ...(input.ip !== undefined ? { ip: input.ip } : {}),
        ...(input.deviceFingerprint !== undefined
          ? { deviceFingerprint: input.deviceFingerprint }
          : {}),
      },
      input.tenantId,
    );
    const evaluation = this.deps.riskEngine.evaluate(signals);
    return { score: evaluation.score.value, band: evaluation.score.band };
  }

  private async ensureDevice(
    tenantId: string,
    fingerprint: string | undefined,
    principalRef: string,
    tenantRef: string | null,
    tx: unknown,
  ): Promise<void> {
    if (fingerprint === undefined) return;
    const existing = await this.deps.devices.findByFingerprint(fingerprint, tenantId, tx);
    if (existing === null) {
      const device = Device.register(
        UniqueEntityId.from(this.deps.idGenerator.generate()),
        { fingerprint, principalRef, tenantRef },
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.devices.save(device, tenantId, tx);
    } else {
      existing.touch(this.deps.clock.now());
      await this.deps.devices.save(existing, tenantId, tx);
    }
  }

  private async fail(
    input: AuthenticateInput,
    risk: { score: number; band: RiskBand },
    reason: string,
  ): Promise<Result<AuthenticationOutcome, DomainError>> {
    return this.deps.unitOfWork.run<Result<AuthenticationOutcome, DomainError>>(async (tx) => {
      this.deps.telemetry.increment("security.login.failed");
      this.deps.telemetry.increment("security.auth.failed");
      await this.deps.outbox.publish(
        [
          securityEvent(
            this.deps,
            "auth",
            this.deps.idGenerator.generate(),
            input.identifier,
            "security.auth.failed",
            "denied",
          ),
        ],
        input.tenantId,
        tx,
      );
      await recordAudit(this.deps, tx, {
        tenantId: input.tenantId,
        principalRef: input.identifier,
        action: "security.auth.failed",
        decision: "deny",
        metadata: { method: input.method, reason, risk: String(risk.score) },
      });
      return ok({
        authenticated: false,
        principalExternalId: null,
        sessionId: null,
        mfaRequirement: "none",
        riskScore: risk.score,
        riskBand: risk.band,
        reason,
      });
    });
  }
}
