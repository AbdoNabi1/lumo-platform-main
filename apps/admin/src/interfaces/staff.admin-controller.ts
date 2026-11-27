import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Clock, Principal } from "@platform/contracts";
import {
  normalizeStaffEmail,
  type SecurityController,
  type StaffMemberView,
  type StaffRole,
} from "@platform/security";
import type { Result } from "@platform/types";
import {
  AppError,
  ConflictError,
  DomainError,
  ValidationError,
  logger,
  toErrorEnvelope,
} from "@platform/utils";
import { staffInviteEmail } from "../infrastructure/email-templates";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";
import type { EmailSender } from "./email-sender.port";
import type { LiveStaffAccessControl } from "./live-staff-access-control";

/**
 * The store directory as the invitation flow needs it: a closure-shaped port, so the controller holds no
 * tenancy object (the multi-tenant boot check walks the graph for construction-time tenant ids and exempts
 * only the root `tenancy`).
 */
export interface StaffDirectoryPort {
  find(
    email: string,
  ): Promise<{ readonly shopId: string; readonly ownerExternalId: string } | null>;
  reserve(input: {
    readonly email: string;
    readonly shopId: string;
    readonly ownerExternalId: string;
    readonly replaceSameShop?: boolean;
  }): Promise<Result<unknown, DomainError>>;
  release(input: {
    readonly email: string;
    readonly shopId: string;
    readonly ownerExternalId: string;
  }): Promise<Result<unknown, DomainError>>;
}

export interface StaffAdminControllerDeps {
  readonly security: SecurityController;
  readonly directory: StaffDirectoryPort;
  /** The REAL delivery capability (Resend). Absent ⇒ invitations answer 503 before any write. */
  readonly staffInviteEmailSender?: EmailSender;
  readonly adminPublicUrl?: string;
  readonly guard: AdminGuard;
  readonly clock: Clock;
  readonly liveAccess: LiveStaffAccessControl;
  /**
   * Wave 1e: the sign-in code step is live (a token issuer AND the real TOTP provider with its key).
   * Without it "require two-step" can't be turned on and the policy read says so.
   */
  readonly codeStepAvailable: boolean;
  /**
   * Wave 1f (D25/D29): two-step is required for everyone on the platform (rule on AND the code step
   * available). While true the per-store switch is read-only: the policy read says `platformRequired`
   * and the policy write is a 409.
   */
  readonly twoStepRequired: boolean;
}

/** A failure with a fixed wire code that the client may retry (an email that bounced, say). */
class RetryableStaffError extends DomainError {
  readonly retryable = true;
}

const INVITATION_INVALID: AdminResponse = {
  status: 410,
  body: toErrorEnvelope(
    new AppError("This invitation link is invalid or has expired", { code: "INVITATION_INVALID" }),
  ),
};

const NOT_CONFIGURED: AdminResponse = {
  status: 503,
  body: toErrorEnvelope(
    new AppError("Email isn't set up, so invitations can't be sent", { code: "NOT_CONFIGURED" }),
  ),
};

const POLICY_PLATFORM_REQUIRED: AdminResponse = {
  status: 409,
  body: toErrorEnvelope(
    new AppError("Two-step verification is required for everyone on Morbeh", {
      code: "TWO_STEP_REQUIRED",
    }),
  ),
};

const EMAIL_FAILED: AdminResponse = {
  status: 502,
  body: toErrorEnvelope(
    new RetryableStaffError(
      "The invitation was saved but the email couldn't be sent. Use Resend.",
      {
        code: "EMAIL_FAILED",
      },
    ),
  ),
};

const ROLE_LABELS: Readonly<Record<StaffRole, { readonly en: string; readonly ar: string }>> = {
  admin: { en: "Admin", ar: "مدير" },
  operator: { en: "Operator", ar: "مشغّل" },
  viewer: { en: "Viewer", ar: "مشاهد" },
};
const FALLBACK_LABEL = { en: "Staff", ar: "عضو فريق" } as const;

const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");

/** A fresh single-use invitation token (32 random bytes) and the hash Security stores. */
function newToken(): { readonly token: string; readonly tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256Hex(token) };
}

/** Wave 1d: Settings > Users and permissions for the admin API. Every method guards first, except the public accept. */
export class StaffAdminController {
  private readonly deps: StaffAdminControllerDeps;

  constructor(deps: StaffAdminControllerDeps) {
    this.deps = deps;
  }

  async list(principal: Principal, tenantId: string): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "staff:read");
    if (denied) return denied;
    return this.deps.security.listStaff({
      tenantId,
      actorExternalId: principal.id,
      now: this.deps.clock.now(),
    });
  }

  /** Wave 1e: the store's two-step policy and what stands in the way of turning it on. */
  async securityPolicy(principal: Principal, tenantId: string): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "staff:read_policy");
    if (denied) return denied;
    const policy = await this.deps.security.getStaffSecurityPolicy({
      tenantId,
      codeStepAvailable: this.deps.codeStepAvailable,
    });
    if (policy.status !== 200) return policy;
    return {
      ...policy,
      body: { ...(policy.body as object), platformRequired: this.deps.twoStepRequired },
    };
  }

  async setRequireTwoStep(
    principal: Principal,
    tenantId: string,
    enabled: boolean,
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "staff:set_policy");
    if (denied) return denied;
    if (this.deps.twoStepRequired) return POLICY_PLATFORM_REQUIRED;
    return this.deps.security.setRequireTwoStep({
      tenantId,
      actorExternalId: principal.id,
      enabled,
      codeStepAvailable: this.deps.codeStepAvailable,
    });
  }

  /** Wave 1e: who did what (sign-ins, invitations, role and two-step changes), newest first, paged. */
  async activity(
    principal: Principal,
    tenantId: string,
    query: { readonly member?: string; readonly cursor?: string; readonly limit?: number },
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "staff:read_activity");
    if (denied) return denied;
    return this.deps.security.listStaffActivity({
      tenantId,
      ...(query.member === undefined ? {} : { memberExternalId: query.member }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
  }

  async invite(
    principal: Principal,
    tenantId: string,
    input: { readonly email: string; readonly role: StaffRole },
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "staff:invite");
    if (denied) return denied;
    const delivery = this.delivery();
    if (delivery === null) return NOT_CONFIGURED;

    let email: string;
    try {
      email = normalizeStaffEmail(input.email);
    } catch (error) {
      if (error instanceof ValidationError) return { status: 422, body: toErrorEnvelope(error) };
      throw error;
    }

    const known = await this.conflictFor(principal, tenantId, email);
    if (known !== null) return known;

    const ownerExternalId = randomUUID();
    const { token, tokenHash } = newToken();

    // (4) hold the email for this store. A same-store leftover (a release that failed earlier) is taken over.
    const previous = await this.deps.directory.find(email);
    const reserved = await this.deps.directory.reserve({
      email,
      shopId: tenantId,
      ownerExternalId,
      replaceSameShop: true,
    });
    if (!reserved.ok) {
      if (reserved.error instanceof ConflictError) {
        return {
          status: 409,
          body: toErrorEnvelope(new ConflictError("This email is already used by another store")),
        };
      }
      return { status: 422, body: toErrorEnvelope(reserved.error) };
    }

    // (5) the invitation. Any failure gives the reservation back before the failure is answered.
    let created: AdminResponse;
    try {
      created = await this.deps.security.createStaffInvitation({
        tenantId,
        actorExternalId: principal.id,
        principalExternalId: ownerExternalId,
        email,
        role: input.role,
        tokenHash,
        now: this.deps.clock.now(),
      });
    } catch (error) {
      await this.giveBack(tenantId, email, ownerExternalId, previous);
      throw error;
    }
    if (created.status !== 201) {
      await this.giveBack(tenantId, email, ownerExternalId, previous);
      return created;
    }
    const { invitationId } = created.body as { readonly invitationId: string };

    // (6) the email. A failure leaves the invitation pending; Resend rotates the token.
    const sent = await this.sendInvite(delivery, tenantId, email, token, input.role);
    if (!sent) return EMAIL_FAILED;
    return { status: 201, body: { invitationId, principalExternalId: ownerExternalId } };
  }

  async resend(
    principal: Principal,
    tenantId: string,
    invitationId: string,
    expectedVersion: number,
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "staff:invite");
    if (denied) return denied;
    const delivery = this.delivery();
    if (delivery === null) return NOT_CONFIGURED;

    const { token, tokenHash } = newToken();
    const renewed = await this.deps.security.renewStaffInvitation({
      tenantId,
      actorExternalId: principal.id,
      invitationId,
      expectedVersion,
      tokenHash,
      now: this.deps.clock.now(),
    });
    if (renewed.status !== 200) return renewed;
    const { version, email } = renewed.body as { readonly version: number; readonly email: string };

    const role = await this.roleOfInvitation(principal, tenantId, invitationId);
    const sent = await this.sendInvite(delivery, tenantId, email, token, role);
    if (!sent) return EMAIL_FAILED;
    return { status: 200, body: { invitationId, version } };
  }

  async revoke(
    principal: Principal,
    tenantId: string,
    invitationId: string,
    expectedVersion: number,
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "staff:invite");
    if (denied) return denied;
    const revoked = await this.deps.security.revokeStaffInvitation({
      tenantId,
      actorExternalId: principal.id,
      invitationId,
      expectedVersion,
      now: this.deps.clock.now(),
    });
    if (revoked.status !== 200) return revoked;
    const { email, principalExternalId } = revoked.body as {
      readonly email: string;
      readonly principalExternalId: string;
    };
    // The invitation is already revoked: a failed release is logged, never surfaced; the next invite of
    // this email recovers the leftover row through `replaceSameShop`.
    await this.release(tenantId, email, principalExternalId);
    this.deps.liveAccess.invalidate(tenantId, principalExternalId);
    return { status: 200, body: { invitationId } };
  }

  async changeRole(
    principal: Principal,
    tenantId: string,
    targetExternalId: string,
    role: StaffRole,
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "staff:change_role");
    if (denied) return denied;
    const changed = await this.deps.security.changeStaffRole({
      tenantId,
      actorExternalId: principal.id,
      targetExternalId,
      role,
    });
    if (changed.status === 200) this.deps.liveAccess.invalidate(tenantId, targetExternalId);
    return changed;
  }

  async setActive(
    principal: Principal,
    tenantId: string,
    targetExternalId: string,
    active: boolean,
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "staff:deactivate");
    if (denied) return denied;
    const changed = await this.deps.security.setStaffActive({
      tenantId,
      actorExternalId: principal.id,
      targetExternalId,
      active,
    });
    if (changed.status === 200) this.deps.liveAccess.invalidate(tenantId, targetExternalId);
    return changed;
  }

  /**
   * Wave 1f (D28): an admin resets a colleague's two-step. Security refuses the owner and the actor's own;
   * on success the target's enrolments are gone and their sessions revoked, so the live check forgets them.
   */
  async resetTwoStep(
    principal: Principal,
    tenantId: string,
    targetExternalId: string,
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "staff:reset_two_step");
    if (denied) return denied;
    const done = await this.deps.security.resetStaffTwoStep({
      tenantId,
      actorExternalId: principal.id,
      targetExternalId,
    });
    if (done.status === 200) this.deps.liveAccess.invalidate(tenantId, targetExternalId);
    return done;
  }

  /**
   * Public (no guard): the invitee sets a password with the single-use link. No tenancy call at all (the
   * directory row is already active). Everything that is not "the password is weak" answers the SAME 410,
   * so the response never says whether the email, the token or the store exists. A retry after a lost
   * response gets 410 and the person simply signs in.
   */
  async acceptInvitation(input: {
    readonly tenantId: string;
    readonly token: string;
    readonly password: string;
  }): Promise<AdminResponse> {
    const outcome = await this.deps.security.acceptStaffInvitation({
      tenantId: input.tenantId,
      tokenHash: sha256Hex(input.token),
      password: input.password,
      now: this.deps.clock.now(),
    });
    if (outcome.status === 200) return { status: 200, body: {} };
    if (outcome.status === 422) return outcome;
    if (outcome.status === 404 || outcome.status === 409) return INVITATION_INVALID;
    return outcome;
  }

  private delivery(): { readonly sender: EmailSender; readonly origin: string } | null {
    const { staffInviteEmailSender, adminPublicUrl } = this.deps;
    if (staffInviteEmailSender === undefined || adminPublicUrl === undefined) return null;
    return { sender: staffInviteEmailSender, origin: adminPublicUrl.replace(/\/$/, "") };
  }

  /** 409 when this email is already on the staff or has a pending invitation (the texts Security uses). */
  private async conflictFor(
    principal: Principal,
    tenantId: string,
    email: string,
  ): Promise<AdminResponse | null> {
    const listed = await this.deps.security.listStaff({
      tenantId,
      actorExternalId: principal.id,
      now: this.deps.clock.now(),
    });
    if (listed.status !== 200) return listed;
    const match = (listed.body as { readonly items: readonly StaffMemberView[] }).items.find(
      (item) => item.email === email,
    );
    if (match === undefined) return null;
    const pending = match.status === "invited" || match.status === "invitation_expired";
    return {
      status: 409,
      body: toErrorEnvelope(
        new ConflictError(
          pending
            ? "This email already has a pending invitation"
            : "This person is already on your staff",
        ),
      ),
    };
  }

  private async roleOfInvitation(
    principal: Principal,
    tenantId: string,
    invitationId: string,
  ): Promise<StaffRole | null> {
    const listed = await this.deps.security.listStaff({
      tenantId,
      actorExternalId: principal.id,
      now: this.deps.clock.now(),
    });
    if (listed.status !== 200) return null;
    const item = (listed.body as { readonly items: readonly StaffMemberView[] }).items.find(
      (entry) => entry.invitation?.id === invitationId,
    );
    return item === undefined || item.role === "owner" ? null : item.role;
  }

  private async sendInvite(
    delivery: { readonly sender: EmailSender; readonly origin: string },
    tenantId: string,
    email: string,
    token: string,
    role: StaffRole | null,
  ): Promise<boolean> {
    const label = role === null ? FALLBACK_LABEL : ROLE_LABELS[role];
    const link = `${delivery.origin}/accept-invite?token=${encodeURIComponent(token)}&store=${encodeURIComponent(tenantId)}`;
    try {
      await delivery.sender.send({
        to: email,
        ...staffInviteEmail(link, null, label.en, label.ar),
      });
      return true;
    } catch (error) {
      logger.warn(
        "staff invitation email was not sent; the invitation stays pending (use Resend)",
        {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return false;
    }
  }

  private async release(tenantId: string, email: string, ownerExternalId: string): Promise<void> {
    try {
      const released = await this.deps.directory.release({
        email,
        shopId: tenantId,
        ownerExternalId,
      });
      if (!released.ok) {
        logger.warn("staff directory release failed; the next invite recovers it", {
          tenantId,
          error: released.error.message,
        });
      }
    } catch (error) {
      logger.warn("staff directory release failed; the next invite recovers it", {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** After a failed invitation: put the directory row back as it was (release when there was none). */
  private async giveBack(
    tenantId: string,
    email: string,
    ownerExternalId: string,
    previous: { readonly shopId: string; readonly ownerExternalId: string } | null,
  ): Promise<void> {
    if (previous !== null && previous.shopId === tenantId) {
      try {
        const restored = await this.deps.directory.reserve({
          email,
          shopId: tenantId,
          ownerExternalId: previous.ownerExternalId,
          replaceSameShop: true,
        });
        if (restored.ok) return;
      } catch {
        // fall through to the log below
      }
      logger.warn("staff directory restore failed; the next invite recovers it", { tenantId });
      return;
    }
    await this.release(tenantId, email, ownerExternalId);
  }
}
