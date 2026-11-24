import type { UseCase } from "@platform/application";
import { UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import {
  BusinessRuleError,
  ConflictError,
  type DomainError,
  NotFoundError,
  ValidationError,
} from "@platform/utils";
import { Principal } from "../domain/principal";
import { RoleAssignment } from "../domain/role-assignment";
import { STAFF_ROLES, type StaffRole } from "../domain/staff";
import { INVITATION_TTL_MS, StaffInvitation } from "../domain/staff-invitation";
import { recordAudit, securityEvent, type StaffDeps } from "./deps";
import {
  adminsAfterChange,
  ensureStaffRoles,
  highestStaffRole,
  loadStaffDirectory,
  requireActiveStaffAdmin,
  runStaffCommand,
  staffIdentifier,
} from "./staff-support";

/*
 * Wave 1d — the guarded staff writes. Every command is ONE unit of work wrapped in the tenant staff
 * lock; it writes through repositories with that unit of work's `tx` (never through the public
 * RegisterPrincipal / TransitionPrincipal / AssignRole use cases, each of which opens its own), it
 * re-reads the actor under the lock and validates every invariant BEFORE its first write (the
 * in-memory unit of work cannot roll back; Postgres rolls back on the thrown rejection anyway).
 */

const NO_LONGER_VALID = "This invitation is no longer valid";
const FIXED_ROLE_KEYS: readonly string[] = STAFF_ROLES;

const invalid = (field: string, summary: string, message = summary): ValidationError =>
  new ValidationError(summary, [{ field, message }]);

function requireStaffRole(role: unknown): StaffRole {
  if (typeof role !== "string" || !(STAFF_ROLES as readonly string[]).includes(role))
    throw invalid("role", "Choose admin, operator or viewer", "must be admin, operator or viewer");
  return role as StaffRole;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim + lower-case; `^[^\s@]+@[^\s@]+\.[^\s@]+$`, at most 254 characters — else ValidationError `email`. */
export function normalizeStaffEmail(raw: unknown): string {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (email.length === 0 || email.length > 254 || !EMAIL_SHAPE.test(email))
    throw invalid("email", "Enter a valid email address", "must be a valid email address");
  return email;
}

function requireNonBlank(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw invalid(field, `${field} is required`, "is required");
  return value;
}

const assignmentId = (deps: StaffDeps): UniqueEntityId =>
  UniqueEntityId.from(deps.idGenerator.generate());

async function grantRole(
  deps: StaffDeps,
  tenantId: string,
  principalInternalId: string,
  roleKey: string,
  grantedBy: string,
  now: Date,
  tx: unknown,
): Promise<void> {
  await deps.assignments.save(
    RoleAssignment.grant(
      assignmentId(deps),
      { principalRef: principalInternalId, roleKey, grantedBy },
      deps.idGenerator.generate(),
      now,
    ),
    tenantId,
    tx,
  );
}

/** Revokes the principal's ACTIVE fixed-role assignments, except the key in `keep`. */
async function revokeStaffAssignments(
  deps: StaffDeps,
  tenantId: string,
  principalInternalId: string,
  keep: string | null,
  now: Date,
  tx: unknown,
): Promise<void> {
  const held = await deps.assignments.listByPrincipal(principalInternalId, tenantId, tx);
  for (const assignment of held) {
    if (!assignment.isActiveAt(now) || !FIXED_ROLE_KEYS.includes(assignment.roleKey)) continue;
    if (assignment.roleKey === keep) continue;
    assignment.revoke(deps.idGenerator.generate(), now);
    await deps.assignments.save(assignment, tenantId, tx);
  }
}

/** Revokes every active session of the principal (and tells the identity provider, like RevokeAllSessions). */
async function revokeSessionsInTx(
  deps: StaffDeps,
  tenantId: string,
  principal: Principal,
  now: Date,
  tx: unknown,
): Promise<number> {
  const sessions = await deps.sessions.listByPrincipal(principal.id.toString(), tenantId, tx);
  let revoked = 0;
  for (const session of sessions) {
    if (!session.isActive) continue;
    session.revoke(deps.idGenerator.generate(), now);
    await deps.sessions.save(session, tenantId, tx);
    revoked += 1;
  }
  if (principal.subjectRef !== null) {
    await deps.outbox.publish(
      [
        securityEvent(
          deps,
          "session",
          principal.id.toString(),
          principal.subjectRef,
          "security.session.revoked_all",
          "revoked",
        ),
      ],
      tenantId,
      tx,
    );
  }
  return revoked;
}

async function auditStaff(
  deps: StaffDeps,
  tx: unknown,
  input: {
    readonly tenantId: string;
    readonly action: string;
    readonly target: string;
    readonly actor: string;
    readonly extra?: Readonly<Record<string, string>>;
  },
): Promise<void> {
  await recordAudit(deps, tx, {
    tenantId: input.tenantId,
    principalRef: input.target,
    action: input.action,
    decision: "allow",
    metadata: { ...input.extra, actor: input.actor, target: input.target },
  });
}

async function loadPrincipal(
  deps: StaffDeps,
  tenantId: string,
  externalId: string,
  tx: unknown,
): Promise<Principal> {
  const principal = await deps.principals.findByExternalId(externalId, tenantId, tx);
  if (principal === null) throw new NotFoundError("Staff member not found");
  return principal;
}

// ── ChangeStaffRole ────────────────────────────────────────────────────────────────────────────

export interface ChangeStaffRoleInput {
  readonly tenantId: string;
  readonly actorExternalId: string;
  readonly targetExternalId: string;
  readonly role: StaffRole;
}

/**
 * Replaces a staff member's fixed role (an invited target included: its pending assignment is
 * swapped). The owner and the actor themselves are refused; the change may never leave a store
 * without an active admin-level principal.
 */
export class ChangeStaffRole implements UseCase<
  ChangeStaffRoleInput,
  { readonly role: StaffRole },
  DomainError
> {
  constructor(private readonly deps: StaffDeps) {}

  async execute(
    input: ChangeStaffRoleInput,
  ): Promise<Result<{ readonly role: StaffRole }, DomainError>> {
    const { deps } = this;
    const { tenantId } = input;
    return runStaffCommand(deps, tenantId, async (tx) => {
      const role = requireStaffRole(input.role);
      const now = deps.clock.now();
      await requireActiveStaffAdmin(deps, tenantId, input.actorExternalId, now, tx);
      const directory = await loadStaffDirectory(deps, tenantId, now, tx);
      const target = directory.staff.get(input.targetExternalId);
      if (target === undefined) throw new NotFoundError("Staff member not found");
      if (target.isOwner) throw new BusinessRuleError("The store owner's role can't be changed");
      if (target.principal.externalId === input.actorExternalId)
        throw new BusinessRuleError("You can't change your own role");

      const held = new Set([...target.roleKeys].filter((k) => FIXED_ROLE_KEYS.includes(k)));
      if (held.size === 1 && held.has(role)) return { role };

      const active = target.principal.status === "active";
      const removed =
        held.has("admin") && role !== "admin" ? target.principal.externalId : undefined;
      const added = active && role === "admin" ? target.principal.externalId : undefined;
      if (
        adminsAfterChange(directory, {
          ...(removed === undefined ? {} : { removed }),
          ...(added === undefined ? {} : { added }),
        }) === 0
      )
        throw new BusinessRuleError("A store needs at least one admin");

      // ── first write ──
      await ensureStaffRoles(deps, tenantId, tx);
      const principalInternalId = target.principal.id;
      await revokeStaffAssignments(deps, tenantId, principalInternalId, role, now, tx);
      if (!held.has(role))
        await grantRole(deps, tenantId, principalInternalId, role, input.actorExternalId, now, tx);
      await auditStaff(deps, tx, {
        tenantId,
        action: "security.staff.role_changed",
        target: target.principal.externalId,
        actor: input.actorExternalId,
        extra: { from: highestStaffRole(held) ?? "none", to: role },
      });
      return { role };
    });
  }
}

// ── SetStaffActive ─────────────────────────────────────────────────────────────────────────────

export interface SetStaffActiveInput {
  readonly tenantId: string;
  readonly actorExternalId: string;
  readonly targetExternalId: string;
  readonly active: boolean;
}

export type SetStaffActiveStatus = "active" | "deactivated";

/** Deactivates (suspends + signs out everywhere) or reactivates a staff member. */
export class SetStaffActive implements UseCase<
  SetStaffActiveInput,
  { readonly status: SetStaffActiveStatus },
  DomainError
> {
  constructor(private readonly deps: StaffDeps) {}

  async execute(
    input: SetStaffActiveInput,
  ): Promise<Result<{ readonly status: SetStaffActiveStatus }, DomainError>> {
    const { deps } = this;
    const { tenantId } = input;
    return runStaffCommand(deps, tenantId, async (tx) => {
      const now = deps.clock.now();
      await requireActiveStaffAdmin(deps, tenantId, input.actorExternalId, now, tx);
      const directory = await loadStaffDirectory(deps, tenantId, now, tx);
      const target = directory.staff.get(input.targetExternalId);
      if (target === undefined) throw new NotFoundError("Staff member not found");
      if (target.isOwner) throw new BusinessRuleError("The store owner can't be deactivated");
      if (target.principal.externalId === input.actorExternalId)
        throw new BusinessRuleError("You can't deactivate yourself");
      if (target.invitation !== null) throw new BusinessRuleError("Revoke the invitation instead");

      const status: SetStaffActiveStatus = input.active ? "active" : "deactivated";
      const wanted = input.active ? "active" : "suspended";
      if (target.principal.status === wanted) return { status };
      if (
        !input.active &&
        adminsAfterChange(directory, { removed: target.principal.externalId }) === 0
      )
        throw new BusinessRuleError("A store needs at least one admin");

      // ── first write ──
      await ensureStaffRoles(deps, tenantId, tx);
      const principal = await loadPrincipal(deps, tenantId, input.targetExternalId, tx);
      const eventId = deps.idGenerator.generate();
      if (input.active) principal.activate(eventId, now);
      else principal.suspend(eventId, now);
      await deps.principals.save(principal, tenantId, tx);
      const revoked = input.active
        ? 0
        : await revokeSessionsInTx(deps, tenantId, principal, now, tx);
      await auditStaff(deps, tx, {
        tenantId,
        action: input.active ? "security.staff.reactivated" : "security.staff.deactivated",
        target: principal.externalId,
        actor: input.actorExternalId,
        ...(input.active ? {} : { extra: { revokedSessions: String(revoked) } }),
      });
      return { status };
    });
  }
}

// ── CreateStaffInvitation ──────────────────────────────────────────────────────────────────────

export interface CreateStaffInvitationInput {
  readonly tenantId: string;
  readonly actorExternalId: string;
  /** The caller-supplied externalId (a uuid) of the new, suspended principal. */
  readonly principalExternalId: string;
  readonly email: string;
  readonly role: StaffRole;
  /** SHA-256 hex of the single-use token; the token itself never reaches this context. */
  readonly tokenHash: string;
  readonly now: Date;
}

export interface CreateStaffInvitationOutput {
  readonly invitationId: string;
  readonly principalExternalId: string;
  /** `staff:<email>` — the credential identifier the invitee will own once they accept. */
  readonly identifier: string;
}

/**
 * Invites an email to a fixed staff role: a SUSPENDED principal holding the role and a pending
 * invitation. No credential and no password exist until acceptance, so password reset can never act
 * on an invitation.
 */
export class CreateStaffInvitation implements UseCase<
  CreateStaffInvitationInput,
  CreateStaffInvitationOutput,
  DomainError
> {
  constructor(private readonly deps: StaffDeps) {}

  async execute(
    input: CreateStaffInvitationInput,
  ): Promise<Result<CreateStaffInvitationOutput, DomainError>> {
    const { deps } = this;
    const { tenantId, now } = input;
    return runStaffCommand(deps, tenantId, async (tx) => {
      const email = normalizeStaffEmail(input.email);
      const role = requireStaffRole(input.role);
      const tokenHash = requireNonBlank("tokenHash", input.tokenHash);
      const principalExternalId = requireNonBlank("principalExternalId", input.principalExternalId);
      await requireActiveStaffAdmin(deps, tenantId, input.actorExternalId, now, tx);

      const identifier = staffIdentifier(email);
      if ((await deps.staffCredentials.find(tenantId, identifier)) !== null)
        throw new ConflictError("This person is already on your staff");
      if ((await deps.staffInvitations.findPendingByEmail(tenantId, email, tx)) !== null)
        throw new ConflictError("This email already has a pending invitation");
      if ((await deps.principals.findByExternalId(principalExternalId, tenantId, tx)) !== null)
        throw new ConflictError("This invitation could not be created");
      if ((await deps.staffInvitations.findByTokenHash(tenantId, tokenHash, tx)) !== null)
        throw new ConflictError("This invitation could not be created");

      const invitation = StaffInvitation.create(
        UniqueEntityId.from(deps.idGenerator.generate()),
        {
          tenantId,
          email,
          principalExternalId,
          roleKey: role,
          invitedBy: input.actorExternalId,
          tokenHash,
        },
        now,
        INVITATION_TTL_MS,
      );
      // Register, then suspend BEFORE the first save: the principal is never visible as active.
      const principal = Principal.register(
        UniqueEntityId.from(deps.idGenerator.generate()),
        {
          externalId: principalExternalId,
          kind: "human",
          displayName: email,
          subjectRef: principalExternalId,
          tenantRef: tenantId,
        },
        deps.idGenerator.generate(),
        now,
      );
      principal.suspend(deps.idGenerator.generate(), now);

      // ── first write ──
      await ensureStaffRoles(deps, tenantId, tx);
      await deps.principals.save(principal, tenantId, tx);
      await grantRole(
        deps,
        tenantId,
        principal.id.toString(),
        role,
        input.actorExternalId,
        now,
        tx,
      );
      await deps.staffInvitations.save(invitation, tx);
      await auditStaff(deps, tx, {
        tenantId,
        action: "security.staff.invited",
        target: principalExternalId,
        actor: input.actorExternalId,
        extra: { role, invitationId: invitation.id.toString() },
      });
      return { invitationId: invitation.id.toString(), principalExternalId, identifier };
    });
  }
}

// ── RenewStaffInvitation ───────────────────────────────────────────────────────────────────────

export interface RenewStaffInvitationInput {
  readonly tenantId: string;
  readonly actorExternalId: string;
  readonly invitationId: string;
  readonly expectedVersion: number;
  /** SHA-256 hex of the NEW token; the previous link dies at once. */
  readonly tokenHash: string;
  readonly now: Date;
}

async function loadInvitation(
  deps: StaffDeps,
  tenantId: string,
  invitationId: string,
  expectedVersion: number,
  tx: unknown,
): Promise<StaffInvitation> {
  const invitation = await deps.staffInvitations.findById(tenantId, invitationId, tx);
  if (invitation === null) throw new NotFoundError("Invitation not found");
  if (invitation.version !== expectedVersion)
    throw new ConflictError("This invitation was changed by someone else");
  return invitation;
}

/** Resend: a fresh single-use token and seven fresh days (expired pending invitations included). */
export class RenewStaffInvitation implements UseCase<
  RenewStaffInvitationInput,
  { readonly invitationId: string; readonly version: number; readonly email: string },
  DomainError
> {
  constructor(private readonly deps: StaffDeps) {}

  async execute(
    input: RenewStaffInvitationInput,
  ): Promise<
    Result<
      { readonly invitationId: string; readonly version: number; readonly email: string },
      DomainError
    >
  > {
    const { deps } = this;
    const { tenantId, now } = input;
    return runStaffCommand(deps, tenantId, async (tx) => {
      const tokenHash = requireNonBlank("tokenHash", input.tokenHash);
      await requireActiveStaffAdmin(deps, tenantId, input.actorExternalId, now, tx);
      const invitation = await loadInvitation(
        deps,
        tenantId,
        input.invitationId,
        input.expectedVersion,
        tx,
      );
      if (invitation.status !== "pending")
        throw new BusinessRuleError("Only a pending invitation can be resent");
      if ((await deps.staffInvitations.findByTokenHash(tenantId, tokenHash, tx)) !== null)
        throw new ConflictError("This invitation could not be created");

      // ── first write ──
      await ensureStaffRoles(deps, tenantId, tx);
      invitation.renew(now, INVITATION_TTL_MS, tokenHash);
      const version = await deps.staffInvitations.save(invitation, tx);
      await auditStaff(deps, tx, {
        tenantId,
        action: "security.staff.invitation_renewed",
        target: invitation.principalExternalId,
        actor: input.actorExternalId,
        extra: { invitationId: invitation.id.toString() },
      });
      return { invitationId: invitation.id.toString(), version, email: invitation.email };
    });
  }
}

// ── RevokeStaffInvitation ──────────────────────────────────────────────────────────────────────

export interface RevokeStaffInvitationInput {
  readonly tenantId: string;
  readonly actorExternalId: string;
  readonly invitationId: string;
  readonly expectedVersion: number;
  readonly now: Date;
}

export interface RevokeStaffInvitationOutput {
  readonly invitationId: string;
  readonly email: string;
  readonly principalExternalId: string;
}

/**
 * Ends an invitation: it becomes `revoked`, the invitee's role assignments are revoked and its
 * principal goes `suspended → disabled` (terminal). Re-inviting the email later creates a new principal.
 */
export class RevokeStaffInvitation implements UseCase<
  RevokeStaffInvitationInput,
  RevokeStaffInvitationOutput,
  DomainError
> {
  constructor(private readonly deps: StaffDeps) {}

  async execute(
    input: RevokeStaffInvitationInput,
  ): Promise<Result<RevokeStaffInvitationOutput, DomainError>> {
    const { deps } = this;
    const { tenantId, now } = input;
    return runStaffCommand(deps, tenantId, async (tx) => {
      await requireActiveStaffAdmin(deps, tenantId, input.actorExternalId, now, tx);
      const invitation = await loadInvitation(
        deps,
        tenantId,
        input.invitationId,
        input.expectedVersion,
        tx,
      );
      if (invitation.status !== "pending")
        throw new BusinessRuleError("Only a pending invitation can be revoked");
      const principal = await deps.principals.findByExternalId(
        invitation.principalExternalId,
        tenantId,
        tx,
      );

      // ── first write ──
      await ensureStaffRoles(deps, tenantId, tx);
      invitation.revoke(now);
      await deps.staffInvitations.save(invitation, tx);
      if (principal !== null) {
        await revokeStaffAssignments(deps, tenantId, principal.id.toString(), null, now, tx);
        if (principal.status !== "disabled") {
          principal.disable(deps.idGenerator.generate(), now);
          await deps.principals.save(principal, tenantId, tx);
        }
      }
      await auditStaff(deps, tx, {
        tenantId,
        action: "security.staff.invitation_revoked",
        target: invitation.principalExternalId,
        actor: input.actorExternalId,
        extra: { invitationId: invitation.id.toString() },
      });
      return {
        invitationId: invitation.id.toString(),
        email: invitation.email,
        principalExternalId: invitation.principalExternalId,
      };
    });
  }
}

// ── AcceptStaffInvitation ──────────────────────────────────────────────────────────────────────

export interface AcceptStaffInvitationInput {
  readonly tenantId: string;
  /** SHA-256 hex of the token the invitee holds. */
  readonly tokenHash: string;
  readonly password: string;
  readonly now: Date;
}

/**
 * The public acceptance: checks the password, finds the invitation by its token hash and — in ONE
 * transaction under the tenant staff lock — saves the `staff:<email>` credential (hashed with the
 * provider's scrypt hasher), activates the principal and marks the invitation accepted. The password
 * is usable only once this command has committed.
 */
export class AcceptStaffInvitation implements UseCase<
  AcceptStaffInvitationInput,
  { readonly principalExternalId: string; readonly email: string },
  DomainError
> {
  constructor(private readonly deps: StaffDeps) {}

  async execute(
    input: AcceptStaffInvitationInput,
  ): Promise<
    Result<{ readonly principalExternalId: string; readonly email: string }, DomainError>
  > {
    const { deps } = this;
    const { tenantId, now } = input;
    try {
      if (
        typeof input.password !== "string" ||
        input.password.length < 8 ||
        input.password.length > 256
      )
        throw invalid(
          "password",
          "Password must be 8 to 256 characters",
          "must be 8 to 256 characters",
        );
      // Cheap pre-check outside the lock so garbage tokens never cost a scrypt run.
      const early =
        input.tokenHash.trim().length === 0
          ? null
          : await deps.staffInvitations.findByTokenHash(tenantId, input.tokenHash);
      if (early === null || early.status !== "pending" || early.isExpired(now))
        throw new BusinessRuleError(NO_LONGER_VALID);
    } catch (error) {
      return failWith(error);
    }
    const passwordHash = await deps.passwordHasher.hash(input.password);

    return runStaffCommand(deps, tenantId, async (tx) => {
      const invitation = await deps.staffInvitations.findByTokenHash(tenantId, input.tokenHash, tx);
      if (invitation === null || invitation.status !== "pending" || invitation.isExpired(now))
        throw new BusinessRuleError(NO_LONGER_VALID);
      const identifier = staffIdentifier(invitation.email);
      if ((await deps.staffCredentials.find(tenantId, identifier)) !== null)
        throw new BusinessRuleError(NO_LONGER_VALID);
      const principal = await deps.principals.findByExternalId(
        invitation.principalExternalId,
        tenantId,
        tx,
      );
      if (principal === null || principal.status !== "suspended")
        throw new BusinessRuleError(NO_LONGER_VALID);

      // ── first write: the credential, so a failure leaves everything else untouched ──
      await deps.staffCredentials.save(
        {
          tenantId,
          identifier,
          principalExternalId: invitation.principalExternalId,
          passwordHash,
        },
        tx,
      );
      principal.activate(deps.idGenerator.generate(), now);
      await deps.principals.save(principal, tenantId, tx);
      invitation.accept(now);
      await deps.staffInvitations.save(invitation, tx);
      await auditStaff(deps, tx, {
        tenantId,
        action: "security.staff.invitation_accepted",
        target: invitation.principalExternalId,
        actor: "invitee",
        extra: { invitationId: invitation.id.toString() },
      });
      return { principalExternalId: invitation.principalExternalId, email: invitation.email };
    });
  }
}

function failWith(error: unknown): Result<never, DomainError> {
  if (error instanceof ValidationError || error instanceof BusinessRuleError)
    return { ok: false, error };
  throw error;
}
