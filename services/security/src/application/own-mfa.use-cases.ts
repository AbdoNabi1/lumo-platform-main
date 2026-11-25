import type { UseCase } from "@platform/application";
import { UniqueEntityId } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { BusinessRuleError, DomainError, NotFoundError } from "@platform/utils";
import { MfaEnrollment } from "../domain/mfa-enrollment";
import type { Principal } from "../domain/principal";
import { recordAudit, type OwnMfaDeps } from "./deps";
import { normalizeMfaCode, TOTP_CODE_SHAPE } from "./mfa-login.use-cases";
import { isTwoStepRequired, runStaffCommand } from "./staff-support";

/*
 * Wave 1e — a signed-in staff member's own two-step verification (authenticator app + backup codes).
 * Every use case that writes runs in `runStaffCommand` (tenant staff lock + ONE unit of work) and
 * validates before its first write. Nothing here ever logs or audits a code, a backup code, a secret
 * or an `otpauth://` link: audit metadata is `{ actor, target, method?, count? }` only.
 */

const BACKUP_CODE_COUNT = 10;
const WRONG_CODE = "That code didn't work. Try again.";
const ALREADY_ON = "Two-step verification is already on";
const NOT_ON = "Two-step verification isn't on";

/** A configuration failure the transport maps to 503 (`NOT_CONFIGURED`). */
export class NotConfiguredError extends DomainError {
  readonly retryable = false;
  constructor(message: string) {
    super(message, { code: "NOT_CONFIGURED" });
  }
}

async function loadActivePrincipal(
  deps: OwnMfaDeps,
  tenantId: string,
  externalId: string,
  tx?: unknown,
): Promise<Principal> {
  const principal = await deps.principals.findByExternalId(externalId, tenantId, tx);
  if (principal === null || !principal.isActive) throw new NotFoundError("Staff member not found");
  return principal;
}

async function listEnrollments(
  deps: OwnMfaDeps,
  tenantId: string,
  principal: Principal,
  tx?: unknown,
): Promise<readonly MfaEnrollment[]> {
  const all = await deps.mfaEnrollments.listByPrincipal(principal.id.toString(), tenantId, tx);
  return all.filter((e) => e.method === "totp");
}

async function auditOwn(
  deps: OwnMfaDeps,
  tx: unknown,
  tenantId: string,
  principal: Principal,
  action: string,
  extra: Readonly<Record<string, string>> = {},
): Promise<void> {
  await recordAudit(deps, tx, {
    tenantId,
    principalRef: principal.externalId,
    action,
    decision: "allow",
    tenantRef: principal.tenantRef ?? tenantId,
    metadata: { ...extra, actor: principal.externalId, target: principal.externalId },
  });
}

/** 10 fresh backup codes: shown as `xxxx-xxxx-xxxx`, stored only as sha256 of the normalised 12 hex. */
async function newBackupCodes(
  deps: OwnMfaDeps,
): Promise<{ readonly shown: string[]; readonly hashes: string[] }> {
  const shown: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i += 1) {
    const raw = normalizeMfaCode(await deps.crypto.randomToken(6));
    shown.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`);
    hashes.push(await deps.crypto.hash(raw));
  }
  return { shown, hashes };
}

/** A TOTP code against an enrolment, replay guard applied; false = wrong. Sets `lastUsedStep` on success. */
async function acceptTotpCode(
  deps: OwnMfaDeps,
  enrollment: MfaEnrollment,
  rawCode: string,
  now: Date,
): Promise<boolean> {
  const code = normalizeMfaCode(rawCode);
  if (!TOTP_CODE_SHAPE.test(code)) return false;
  const provider = deps.mfaProviders.get(enrollment.method);
  if (provider === null) return false;
  const step = await provider.verifyStep({ secretRef: enrollment.secretRef, code, at: now });
  return step !== null && enrollment.acceptStep(step);
}

// ── GetOwnTwoStep ──────────────────────────────────────────────────────────────────────────────

export interface GetOwnTwoStepInput {
  readonly tenantId: string;
  readonly principalExternalId: string;
}

export interface OwnTwoStepStatus {
  readonly enabled: boolean;
  readonly activatedAt: string | null;
  readonly backupCodesLeft: number;
  readonly policyRequired: boolean;
}

export class GetOwnTwoStep implements UseCase<GetOwnTwoStepInput, OwnTwoStepStatus, DomainError> {
  constructor(private readonly deps: OwnMfaDeps) {}

  async execute(input: GetOwnTwoStepInput): Promise<Result<OwnTwoStepStatus, DomainError>> {
    const { deps } = this;
    const principal = await deps.principals.findByExternalId(
      input.principalExternalId,
      input.tenantId,
    );
    if (principal === null) return err(new NotFoundError("Staff member not found"));
    const active = (await listEnrollments(deps, input.tenantId, principal)).find((e) => e.isActive);
    return ok({
      enabled: active !== undefined,
      activatedAt: active?.activatedAt?.toISOString() ?? null,
      backupCodesLeft: active?.remainingBackupCodes ?? 0,
      policyRequired: await isTwoStepRequired(deps, input.tenantId),
    });
  }
}

// ── StartOwnTwoStep ────────────────────────────────────────────────────────────────────────────

export interface StartOwnTwoStepInput {
  readonly tenantId: string;
  readonly principalExternalId: string;
  readonly email: string;
}

export interface StartOwnTwoStepOutput {
  readonly enrollmentId: string;
  readonly manualKey: string;
  readonly provisioningUri: string;
}

/**
 * Begins turning two-step on: a NEW pending enrolment (any earlier pending one of this principal is
 * revoked). Needs the real provider (`options.mfaConfigured`); the result carries the secret ONCE.
 */
export class StartOwnTwoStep implements UseCase<
  StartOwnTwoStepInput,
  StartOwnTwoStepOutput,
  DomainError
> {
  constructor(
    private readonly deps: OwnMfaDeps,
    private readonly options: { readonly mfaConfigured: boolean },
  ) {}

  async execute(input: StartOwnTwoStepInput): Promise<Result<StartOwnTwoStepOutput, DomainError>> {
    const { deps } = this;
    const { tenantId } = input;
    if (!this.options.mfaConfigured)
      return err(new NotConfiguredError("Two-step verification isn't set up on this server"));
    return runStaffCommand(deps, tenantId, async (tx) => {
      const principal = await loadActivePrincipal(deps, tenantId, input.principalExternalId, tx);
      const existing = await listEnrollments(deps, tenantId, principal, tx);
      if (existing.some((e) => e.isActive)) throw new BusinessRuleError(ALREADY_ON);
      const provider = deps.mfaProviders.get("totp");
      if (provider === null) throw new BusinessRuleError('No MFA provider registered for "totp"');
      const enrolled = await provider.enroll({
        principalRef: principal.id.toString(),
        accountLabel: input.email,
      });
      if (enrolled.provisioningUri === undefined || enrolled.manualKey === undefined)
        throw new BusinessRuleError("The authenticator provider returned no key");

      const now = deps.clock.now();
      for (const pending of existing) {
        if (pending.status !== "pending") continue;
        pending.revoke(deps.idGenerator.generate(), now);
        await deps.mfaEnrollments.save(pending, tenantId, tx);
      }
      const enrollment = MfaEnrollment.enroll(
        UniqueEntityId.from(deps.idGenerator.generate()),
        { principalRef: principal.id.toString(), method: "totp", secretRef: enrolled.secretRef },
        deps.idGenerator.generate(),
        now,
      );
      await deps.mfaEnrollments.save(enrollment, tenantId, tx);
      return {
        enrollmentId: enrollment.id.toString(),
        manualKey: enrolled.manualKey,
        provisioningUri: enrolled.provisioningUri,
      };
    });
  }
}

// ── ConfirmOwnTwoStep ──────────────────────────────────────────────────────────────────────────

export interface ConfirmOwnTwoStepInput {
  readonly tenantId: string;
  readonly principalExternalId: string;
  readonly enrollmentId: string;
  readonly code: string;
  readonly now: Date;
}

export interface BackupCodesResult {
  readonly backupCodes: readonly string[];
}

/** Proves the authenticator app works (first code), switches the enrolment on and issues 10 backup codes. */
export class ConfirmOwnTwoStep implements UseCase<
  ConfirmOwnTwoStepInput,
  BackupCodesResult,
  DomainError
> {
  constructor(private readonly deps: OwnMfaDeps) {}

  async execute(input: ConfirmOwnTwoStepInput): Promise<Result<BackupCodesResult, DomainError>> {
    const { deps } = this;
    const { tenantId } = input;
    return runStaffCommand(deps, tenantId, async (tx) => {
      const principal = await loadActivePrincipal(deps, tenantId, input.principalExternalId, tx);
      const enrollment = await deps.mfaEnrollments.findById(input.enrollmentId, tenantId, tx);
      if (
        enrollment === null ||
        enrollment.principalRef !== principal.id.toString() ||
        enrollment.status !== "pending"
      )
        throw new NotFoundError("MFA enrollment not found");
      const others = await listEnrollments(deps, tenantId, principal, tx);
      if (others.some((e) => e.isActive)) throw new BusinessRuleError(ALREADY_ON);
      if (!(await acceptTotpCode(deps, enrollment, input.code, input.now)))
        throw new BusinessRuleError(WRONG_CODE);

      const codes = await newBackupCodes(deps);
      enrollment.markVerified(deps.idGenerator.generate(), deps.clock.now());
      enrollment.setBackupCodes(codes.hashes);
      await deps.mfaEnrollments.save(enrollment, tenantId, tx);
      await auditOwn(deps, tx, tenantId, principal, "security.mfa.enabled", { method: "totp" });
      return { backupCodes: codes.shown };
    });
  }
}

// ── RegenerateOwnBackupCodes ───────────────────────────────────────────────────────────────────

export interface RegenerateOwnBackupCodesInput {
  readonly tenantId: string;
  readonly principalExternalId: string;
  readonly code: string;
  readonly now: Date;
}

/** Replaces the backup codes with 10 fresh ones; needs a current authenticator code. */
export class RegenerateOwnBackupCodes implements UseCase<
  RegenerateOwnBackupCodesInput,
  BackupCodesResult,
  DomainError
> {
  constructor(private readonly deps: OwnMfaDeps) {}

  async execute(
    input: RegenerateOwnBackupCodesInput,
  ): Promise<Result<BackupCodesResult, DomainError>> {
    const { deps } = this;
    const { tenantId } = input;
    return runStaffCommand(deps, tenantId, async (tx) => {
      const principal = await loadActivePrincipal(deps, tenantId, input.principalExternalId, tx);
      const enrollment = (await listEnrollments(deps, tenantId, principal, tx)).find(
        (e) => e.isActive,
      );
      if (enrollment === undefined) throw new BusinessRuleError(NOT_ON);
      if (!(await acceptTotpCode(deps, enrollment, input.code, input.now)))
        throw new BusinessRuleError(WRONG_CODE);

      const codes = await newBackupCodes(deps);
      enrollment.setBackupCodes(codes.hashes);
      await deps.mfaEnrollments.save(enrollment, tenantId, tx);
      await auditOwn(deps, tx, tenantId, principal, "security.mfa.backup_codes_regenerated", {
        count: String(BACKUP_CODE_COUNT),
      });
      return { backupCodes: codes.shown };
    });
  }
}

// ── DisableOwnTwoStep ──────────────────────────────────────────────────────────────────────────

export interface DisableOwnTwoStepInput {
  readonly tenantId: string;
  readonly principalExternalId: string;
  readonly now: Date;
}

/**
 * Turns the principal's own two-step off. The password re-check is the admin layer's job (it has
 * the credential seam) and happens BEFORE this runs; here only the store policy can refuse.
 */
export class DisableOwnTwoStep implements UseCase<
  DisableOwnTwoStepInput,
  { readonly enabled: false },
  DomainError
> {
  constructor(private readonly deps: OwnMfaDeps) {}

  async execute(
    input: DisableOwnTwoStepInput,
  ): Promise<Result<{ readonly enabled: false }, DomainError>> {
    const { deps } = this;
    const { tenantId } = input;
    return runStaffCommand(deps, tenantId, async (tx) => {
      const principal = await loadActivePrincipal(deps, tenantId, input.principalExternalId, tx);
      if (await isTwoStepRequired(deps, tenantId, tx))
        throw new BusinessRuleError(
          "Your store requires two-step verification, so it can't be turned off",
        );
      const active = (await listEnrollments(deps, tenantId, principal, tx)).find((e) => e.isActive);
      if (active === undefined) throw new BusinessRuleError(NOT_ON);
      active.revoke(deps.idGenerator.generate(), input.now);
      await deps.mfaEnrollments.save(active, tenantId, tx);
      await auditOwn(deps, tx, tenantId, principal, "security.mfa.disabled", { method: "totp" });
      return { enabled: false } as const;
    });
  }
}
