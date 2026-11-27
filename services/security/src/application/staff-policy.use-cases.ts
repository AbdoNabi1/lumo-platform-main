import type { UseCase } from "@platform/application";
import { UniqueEntityId } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { BusinessRuleError, type DomainError, ValidationError } from "@platform/utils";
import { TenantSecurityProfile } from "../domain/tenant-security-profile";
import { recordAudit, type StaffDeps } from "./deps";
import {
  isTwoStepRequired,
  loadStaffDirectory,
  requireActiveStaffAdmin,
  runStaffCommand,
  type StaffDirectory,
} from "./staff-support";

/*
 * Wave 1e — the store-wide "require two-step verification for everyone" policy. The flag is the
 * tenant profile's `mfaRequired`, keyed `tenantRef = tenantId`; it binds STAFF sign-in only
 * (`Authenticate.requireEnrolledFactor`). The 1d commands (invite / accept / reactivate) and the
 * own turn-off read the SAME flag through `isTwoStepRequired` while holding the staff lock.
 */

export interface StaffNotEnrolled {
  readonly principalExternalId: string;
  readonly email: string;
}

export interface StaffSecurityPolicy {
  readonly requireTwoStep: boolean;
  readonly codeStepAvailable: boolean;
  readonly activeStaff: number;
  readonly enrolledActiveStaff: number;
  readonly notEnrolled: readonly StaffNotEnrolled[];
  readonly pendingInvitations: number;
}

interface EnrolmentPicture {
  readonly activeStaff: number;
  readonly notEnrolled: readonly StaffNotEnrolled[];
  readonly enrolledIds: ReadonlySet<string>;
  readonly pendingInvitations: number;
}

/** Active staff (an ACTIVE principal owning a `staff:` credential) and who of them has no active enrolment. */
async function enrolmentPicture(
  deps: StaffDeps,
  tenantId: string,
  directory: StaffDirectory,
  tx?: unknown,
): Promise<EnrolmentPicture> {
  const active = [...directory.staff.values()].filter(
    (e) => e.principal.status === "active" && e.hasCredential && e.invitation === null,
  );
  const enrolled = await deps.mfaEnrollments.listActiveByPrincipals(
    tenantId,
    active.map((e) => e.principal.id),
    tx,
  );
  const notEnrolled = active
    .filter((e) => !enrolled.has(e.principal.id))
    .map((e) => ({ principalExternalId: e.principal.externalId, email: e.email }))
    .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
  const enrolledIds = new Set(
    active.filter((e) => enrolled.has(e.principal.id)).map((e) => e.principal.externalId),
  );
  const pending = await deps.staffInvitations.listPending(tenantId, tx);
  return {
    activeStaff: active.length,
    notEnrolled,
    enrolledIds,
    pendingInvitations: pending.length,
  };
}

// ── GetStaffSecurityPolicy ─────────────────────────────────────────────────────────────────────

export interface GetStaffSecurityPolicyInput {
  readonly tenantId: string;
  /** From wiring: the sign-in code step is live (issuer present AND the real TOTP provider + key). */
  readonly codeStepAvailable: boolean;
}

/** The policy flag plus everything the Users page needs to explain why it can or can't be turned on. */
export class GetStaffSecurityPolicy implements UseCase<
  GetStaffSecurityPolicyInput,
  StaffSecurityPolicy,
  DomainError
> {
  constructor(private readonly deps: StaffDeps) {}

  async execute(
    input: GetStaffSecurityPolicyInput,
  ): Promise<Result<StaffSecurityPolicy, DomainError>> {
    const { deps } = this;
    const { tenantId } = input;
    const directory = await loadStaffDirectory(deps, tenantId, deps.clock.now());
    const picture = await enrolmentPicture(deps, tenantId, directory);
    return ok({
      requireTwoStep: await isTwoStepRequired(deps, tenantId),
      codeStepAvailable: input.codeStepAvailable,
      activeStaff: picture.activeStaff,
      enrolledActiveStaff: picture.activeStaff - picture.notEnrolled.length,
      notEnrolled: picture.notEnrolled,
      pendingInvitations: picture.pendingInvitations,
    });
  }
}

// ── SetRequireTwoStep ──────────────────────────────────────────────────────────────────────────

export interface SetRequireTwoStepInput {
  readonly tenantId: string;
  readonly actorExternalId: string;
  readonly enabled: boolean;
  readonly codeStepAvailable: boolean;
}

/**
 * Turns the store policy on or off (ONE unit of work under the staff lock, so enrol / revoke /
 * invite can't race the preconditions). Turning it off is always allowed. Turning it on is refused,
 * in this order: no code step on this server → the actor has no two-step → someone active has none →
 * a pending invitation exists. Setting the value it already has changes and audits nothing.
 */
export class SetRequireTwoStep implements UseCase<
  SetRequireTwoStepInput,
  { readonly requireTwoStep: boolean },
  DomainError
> {
  constructor(private readonly deps: StaffDeps) {}

  async execute(
    input: SetRequireTwoStepInput,
  ): Promise<Result<{ readonly requireTwoStep: boolean }, DomainError>> {
    const { deps } = this;
    const { tenantId, enabled } = input;
    if (typeof enabled !== "boolean") return err(notBoolean());
    return runStaffCommand(deps, tenantId, async (tx) => {
      const now = deps.clock.now();
      const actor = await requireActiveStaffAdmin(deps, tenantId, input.actorExternalId, now, tx);
      const profile = await deps.tenantProfiles.findByTenant(tenantId, tenantId, tx);
      if ((profile?.mfaRequired ?? false) === enabled) return { requireTwoStep: enabled };

      if (enabled) {
        if (!input.codeStepAvailable)
          throw new BusinessRuleError("Two-step sign-in isn't available on this server yet");
        const directory = await loadStaffDirectory(deps, tenantId, now, tx);
        const picture = await enrolmentPicture(deps, tenantId, directory, tx);
        const actorEnrolled = (
          await deps.mfaEnrollments.listActiveByPrincipals(tenantId, [actor.id.toString()], tx)
        ).has(actor.id.toString());
        if (!actorEnrolled)
          throw new BusinessRuleError("Turn on two-step verification for your own account first");
        if (picture.notEnrolled.length > 0)
          throw new BusinessRuleError("Everyone needs two-step verification turned on first");
        if (picture.pendingInvitations > 0)
          throw new BusinessRuleError("Revoke or wait for pending invitations first");
      }

      // ── first write: the profile keyed tenantRef = tenantId (created if absent), same tx ──
      const eventId = deps.idGenerator.generate();
      let saved: TenantSecurityProfile;
      if (profile === null) {
        saved = TenantSecurityProfile.configure(
          UniqueEntityId.from(deps.idGenerator.generate()),
          tenantId,
          { mfaRequired: enabled },
          eventId,
          now,
        );
      } else {
        profile.reconfigure({ mfaRequired: enabled }, eventId, now);
        saved = profile;
      }
      await deps.tenantProfiles.save(saved, tenantId, tx);
      await recordAudit(deps, tx, {
        tenantId,
        principalRef: actor.externalId,
        action: "security.staff.two_step_policy_changed",
        decision: "allow",
        tenantRef: actor.tenantRef ?? tenantId,
        metadata: {
          actor: actor.externalId,
          target: actor.externalId,
          enabled: enabled ? "true" : "false",
        },
      });
      return { requireTwoStep: enabled };
    });
  }
}

function notBoolean(): DomainError {
  return new ValidationError("enabled must be true or false", [
    { field: "enabled", message: "must be true or false" },
  ]);
}
