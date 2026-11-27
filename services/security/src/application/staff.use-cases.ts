import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { StaffMemberView, StaffRole, StaffStatus } from "../domain/staff";
import type { StaffDeps } from "./deps";
import { highestStaffRole, loadStaffDirectory, type StaffEntry } from "./staff-support";

export interface ListStaffInput {
  readonly tenantId: string;
  /** The signed-in staff member's externalId (marks `isSelf`). */
  readonly actorExternalId: string;
  readonly now: Date;
}

export interface ListStaffOutput {
  readonly items: readonly StaffMemberView[];
}

/** Status rule, in order: pending invitation (valid, then expired) → suspended → active. */
function statusOf(entry: StaffEntry, now: Date): StaffStatus {
  if (entry.invitation !== null)
    return entry.invitation.isExpired(now) ? "invitation_expired" : "invited";
  return entry.principal.status === "suspended" ? "deactivated" : "active";
}

/** Role rule: the owner key wins; else the highest fixed staff role; an invitee falls back to its invitation. */
function roleOf(entry: StaffEntry): StaffRole | "owner" | null {
  if (entry.isOwner) return "owner";
  return highestStaffRole(entry.roleKeys) ?? entry.invitation?.roleKey ?? null;
}

/**
 * Lists the store's staff: principals that own a `staff:` credential AND hold `platform-admin`,
 * `admin`, `operator` or `viewer`, plus invitees with a pending invitation (they have no credential
 * yet). Revoked/disabled principals and customers never appear. Owner first, then email ascending.
 * Read-only, no audit.
 */
export class ListStaff implements UseCase<ListStaffInput, ListStaffOutput, DomainError> {
  constructor(private readonly deps: StaffDeps) {}

  async execute(input: ListStaffInput): Promise<Result<ListStaffOutput, DomainError>> {
    const { tenantId, now } = input;
    const directory = await loadStaffDirectory(this.deps, tenantId, now);
    const entries = [...directory.staff.values()];
    const lastSignIn = await this.deps.sessions.lastEstablishedByPrincipals(
      tenantId,
      entries.map((e) => e.principal.id),
    );
    const enrolled = await this.deps.mfaEnrollments.listActiveByPrincipals(
      tenantId,
      entries.map((e) => e.principal.id),
    );
    const items: StaffMemberView[] = [];
    for (const entry of entries) {
      const role = roleOf(entry);
      if (role === null) continue; // a credential with no mapped role is not a staff member
      const lastAt = lastSignIn.get(entry.principal.id);
      items.push({
        principalExternalId: entry.principal.externalId,
        email: entry.email,
        role,
        status: statusOf(entry, now),
        isOwner: entry.isOwner,
        isSelf: entry.principal.externalId === input.actorExternalId,
        addedAt: entry.principal.createdAt.toISOString(),
        lastSignInAt: lastAt === undefined ? null : lastAt.toISOString(),
        twoStep: enrolled.has(entry.principal.id),
        invitation:
          entry.invitation === null
            ? null
            : {
                id: entry.invitation.id.toString(),
                expiresAt: entry.invitation.expiresAt.toISOString(),
                version: entry.invitation.version,
              },
      });
    }
    items.sort((a, b) => {
      if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
      return a.email < b.email ? -1 : a.email > b.email ? 1 : 0;
    });
    return ok({ items });
  }
}

export interface StaffAccessInput {
  readonly tenantId: string;
  readonly principalExternalId: string;
}

export interface StaffAccessOutput {
  readonly status: "active" | "suspended" | "disabled";
  /** Active role keys held right now (raw Security keys, sorted), e.g. `["platform-admin"]`. */
  readonly roleKeys: readonly string[];
}

/**
 * The live access check's read (Wave 1d, D13): the principal's current status and ACTIVE role keys.
 * Resolves the principal by its externalId and reads assignments by its INTERNAL id (never through
 * `resolvePrincipal`, which takes a subjectRef). Unknown principal (or another tenant's) → NOT_FOUND.
 */
export class StaffAccess implements UseCase<StaffAccessInput, StaffAccessOutput, DomainError> {
  constructor(private readonly deps: StaffDeps) {}

  async execute(input: StaffAccessInput): Promise<Result<StaffAccessOutput, DomainError>> {
    const principal = await this.deps.principals.findByExternalId(
      input.principalExternalId,
      input.tenantId,
    );
    if (principal === null) return err(new NotFoundError("Principal not found"));
    const now = this.deps.clock.now();
    const assignments = await this.deps.assignments.listByPrincipal(
      principal.id.toString(),
      input.tenantId,
    );
    const roleKeys = [
      ...new Set(assignments.filter((a) => a.isActiveAt(now)).map((a) => a.roleKey)),
    ].sort();
    return ok({ status: principal.status, roleKeys });
  }
}
