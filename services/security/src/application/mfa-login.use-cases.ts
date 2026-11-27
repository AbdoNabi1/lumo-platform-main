import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { AuthenticationError, ConcurrencyError, type DomainError } from "@platform/utils";
import type { MfaEnrollment } from "../domain/mfa-enrollment";
import type { Principal } from "../domain/principal";
import { recordAudit, type MfaLoginDeps } from "./deps";
import { runStaffCommand } from "./staff-support";

/** Trim, drop spaces and dashes, lower-case — the one shape a code is compared in. */
export function normalizeMfaCode(raw: string): string {
  return raw.trim().replace(/[\s-]/g, "").toLowerCase();
}

export const TOTP_CODE_SHAPE = /^\d{6}$/;
export const BACKUP_CODE_SHAPE = /^[0-9a-f]{12}$/;

/** The sentinel every failed code check answers with — one message, whatever went wrong. */
export const INVALID_CODE_MESSAGE = "Invalid code";

export interface VerifyMfaLoginInput {
  readonly tenantId: string;
  readonly principalExternalId: string;
  readonly code: string;
  readonly now: Date;
}

export interface VerifyMfaLoginOutput {
  readonly principalExternalId: string;
  readonly method: "totp" | "backup";
}

type Outcome = { readonly ok: true; readonly method: "totp" | "backup" } | { readonly ok: false };

const FAILED: Outcome = { ok: false };

/**
 * The second step of a staff sign-in: checks a TOTP code (replay-guarded by the enrolment's last
 * used step) or a single-use backup code for the principal's one active totp enrolment.
 *
 * The whole read-check-save runs inside {@link runStaffCommand} (tenant staff lock + ONE unit of
 * work): that serialises code consumption in BOTH adapters (the in-memory repository shares aggregate
 * references and has no version check); the Prisma version CAS stays as a second guard. Every failure
 * is the SAME `AuthenticationError("Invalid code")`; every failure except an unknown principal is
 * audited as `security.mfa.login_failed` (never the code). A failure is returned, not thrown, so the
 * unit of work commits that audit row.
 */
export class VerifyMfaLogin implements UseCase<
  VerifyMfaLoginInput,
  VerifyMfaLoginOutput,
  DomainError
> {
  constructor(private readonly deps: MfaLoginDeps) {}

  async execute(input: VerifyMfaLoginInput): Promise<Result<VerifyMfaLoginOutput, DomainError>> {
    const { deps } = this;
    const { tenantId } = input;
    const outcome = await runStaffCommand<Outcome>(deps, tenantId, async (tx) => {
      const principal = await deps.principals.findByExternalId(
        input.principalExternalId,
        tenantId,
        tx,
      );
      // No principal, no subject to record against: nothing is audited (the caller still sees a failure).
      if (principal === null) return FAILED;
      const verdict = await this.check(principal, input, tx);
      await this.audit(principal, tenantId, verdict, tx);
      return verdict;
    });
    if (!outcome.ok) return err(new AuthenticationError(INVALID_CODE_MESSAGE));
    const value = outcome.value;
    if (!value.ok) return err(new AuthenticationError(INVALID_CODE_MESSAGE));
    return ok({ principalExternalId: input.principalExternalId, method: value.method });
  }

  private async check(
    principal: Principal,
    input: VerifyMfaLoginInput,
    tx: unknown,
  ): Promise<Outcome> {
    const { deps } = this;
    if (!principal.isActive) return FAILED;
    const enrollments = await deps.mfaEnrollments.listByPrincipal(
      principal.id.toString(),
      input.tenantId,
      tx,
    );
    const active = enrollments.filter((e) => e.isActive && e.method === "totp");
    const enrollment = active.length === 1 ? active[0] : undefined;
    if (enrollment === undefined) return FAILED;

    const code = normalizeMfaCode(input.code);
    let method: "totp" | "backup";
    if (TOTP_CODE_SHAPE.test(code)) {
      if (!(await this.acceptTotp(enrollment, code, input.now))) return FAILED;
      method = "totp";
    } else if (BACKUP_CODE_SHAPE.test(code)) {
      if (!enrollment.consumeBackupCode(await deps.crypto.hash(code))) return FAILED;
      method = "backup";
    } else return FAILED;

    try {
      await deps.mfaEnrollments.save(enrollment, input.tenantId, tx);
    } catch (error) {
      // A concurrent writer won the version check: this attempt is a failure, never a success.
      if (error instanceof ConcurrencyError) return FAILED;
      throw error;
    }
    return { ok: true, method };
  }

  private async acceptTotp(enrollment: MfaEnrollment, code: string, at: Date): Promise<boolean> {
    const provider = this.deps.mfaProviders.get(enrollment.method);
    if (provider === null) return false;
    const step = await provider.verifyStep({ secretRef: enrollment.secretRef, code, at });
    return step !== null && enrollment.acceptStep(step);
  }

  private async audit(
    principal: Principal,
    tenantId: string,
    verdict: Outcome,
    tx: unknown,
  ): Promise<void> {
    const externalId = principal.externalId;
    await recordAudit(this.deps, tx, {
      tenantId,
      principalRef: externalId,
      action: verdict.ok ? "security.mfa.login_verified" : "security.mfa.login_failed",
      decision: verdict.ok ? "allow" : "deny",
      tenantRef: principal.tenantRef ?? tenantId,
      metadata: {
        actor: externalId,
        target: externalId,
        ...(verdict.ok ? { method: verdict.method } : {}),
      },
    });
  }
}
