import type { Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type {
  AccessDecisionOutput,
  EvaluateAccess,
  EvaluateAccessInput,
} from "../application/access.use-cases";
import type {
  Authenticate,
  AuthenticateInput,
  AuthenticationOutcome,
} from "../application/authentication.use-cases";
import type {
  CredentialOutput,
  RotateCredential,
  RotateCredentialInput,
} from "../application/credential.use-cases";
import type { DeviceActionInput, DeviceOutput, TrustDevice } from "../application/device.use-cases";
import type { EnrollMfa, EnrollMfaInput, MfaEnrollmentOutput } from "../application/mfa.use-cases";
import type {
  EvaluateRisk,
  EvaluateRiskInput,
  RiskEvaluationOutput,
} from "../application/risk.use-cases";
import type { SimulatePolicy, SimulatePolicyInput } from "../application/policy.use-cases";
import type {
  FederateExternalSession,
  FederateExternalSessionInput,
  RevokeAllSessions,
  RevokeAllSessionsInput,
  RevokeAllSessionsOutput,
} from "../application/session.use-cases";
import type { ZeroTrustDecision } from "../domain/zero-trust";

export interface SecuritySdkDeps {
  readonly authenticate: Authenticate;
  readonly evaluateAccess: EvaluateAccess;
  readonly evaluateRisk: EvaluateRisk;
  readonly simulatePolicy: SimulatePolicy;
  readonly rotateCredential: RotateCredential;
  readonly revokeAllSessions: RevokeAllSessions;
  readonly federateExternalSession: FederateExternalSession;
  readonly trustDevice: TrustDevice;
  readonly enrollMfa: EnrollMfa;
}

/** The outcome of a federation attempt: the internal session id, or why no session could be bound. */
export interface FederatedSessionOutcome {
  readonly sessionId: string | null;
  readonly reason: string | null;
}

export interface DecisionExplanation {
  readonly effect: string;
  readonly allowed: boolean;
  readonly reasons: readonly string[];
  readonly matchedRuleIds: readonly string[];
  readonly policyKey: string | null;
  readonly policyVersion: number | null;
}

function unwrap<T>(result: Result<T, DomainError>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

/**
 * The official **Security SDK** (sprint P2.0-B §19) — the single ergonomic surface internal services
 * call, so no service reimplements security (doc-27 principle 10). It wraps the use-cases; methods
 * return typed outcomes and throw the kernel `DomainError` on failure. Security **decides** here;
 * enforcement stays at the existing points (Entitlement/Keto/http pipeline).
 */
export class SecuritySdk {
  constructor(private readonly deps: SecuritySdkDeps) {}

  async authenticate(input: AuthenticateInput): Promise<AuthenticationOutcome> {
    return unwrap(await this.deps.authenticate.execute(input));
  }

  async authorize(input: EvaluateAccessInput): Promise<AccessDecisionOutput> {
    return unwrap(await this.deps.evaluateAccess.execute(input));
  }

  async evaluateRisk(input: EvaluateRiskInput): Promise<RiskEvaluationOutput> {
    return unwrap(await this.deps.evaluateRisk.execute(input));
  }

  /** Runs the zero-trust decision and returns only its explanation (reasons + matched rules). */
  async explainDecision(input: EvaluateAccessInput): Promise<DecisionExplanation> {
    const d = unwrap(await this.deps.evaluateAccess.execute(input));
    return {
      effect: d.effect,
      allowed: d.allowed,
      reasons: d.reasons,
      matchedRuleIds: d.matchedRuleIds,
      policyKey: d.policyKey,
      policyVersion: d.policyVersion,
    };
  }

  async simulatePolicy(input: SimulatePolicyInput): Promise<ZeroTrustDecision> {
    return unwrap(await this.deps.simulatePolicy.execute(input));
  }

  async rotateSecret(input: RotateCredentialInput): Promise<CredentialOutput> {
    return unwrap(await this.deps.rotateCredential.execute(input));
  }

  async revokeSessions(input: RevokeAllSessionsInput): Promise<RevokeAllSessionsOutput> {
    return unwrap(await this.deps.revokeAllSessions.execute(input));
  }

  /**
   * Resolves (establishing on first sight) the Security session mirroring an upstream IdP session —
   * ADR-0031. Unlike the other methods this **does not throw** on a refusal: a caller at the HTTP edge
   * must turn "no session" into a normal fail-closed deny, not a 500. Infrastructure faults still throw.
   */
  async federateSession(input: FederateExternalSessionInput): Promise<FederatedSessionOutcome> {
    const result = await this.deps.federateExternalSession.execute(input);
    if (result.ok) return { sessionId: result.value.id, reason: null };
    return { sessionId: null, reason: result.error.message };
  }

  async trustDevice(input: DeviceActionInput): Promise<DeviceOutput> {
    return unwrap(await this.deps.trustDevice.execute(input));
  }

  async enrollMfa(input: EnrollMfaInput): Promise<MfaEnrollmentOutput> {
    return unwrap(await this.deps.enrollMfa.execute(input));
  }
}
