import { isDomainError, UniqueEntityId } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { AuthorizationError, type DomainError } from "@platform/utils";
import type { Principal } from "../domain/principal";
import type { PrincipalSummary } from "../domain/repositories";
import { Role } from "../domain/role";
import { OWNER_ROLE_KEY, STAFF_ROLES, type StaffRole } from "../domain/staff";
import type { StaffInvitation } from "../domain/staff-invitation";
import { recordAudit, type StaffDeps } from "./deps";
import { normalizeIdentifier } from "./password-credentials";

/** The credential identifier prefix of staff sign-in (`staff:<email>`), shared with the admin app. */
export const STAFF_IDENTIFIER_PREFIX = "staff:";

/** Higher rank wins when a staff member holds several staff role keys. */
const ROLE_RANK: Readonly<Record<StaffRole, number>> = { admin: 3, operator: 2, viewer: 1 };

/** Keys that make a credential holder a staff member (the owner key plus the three fixed roles). */
export const STAFF_ASSIGNMENT_KEYS: readonly string[] = [OWNER_ROLE_KEY, ...STAFF_ROLES];

const isStaffRole = (key: string): key is StaffRole =>
  (STAFF_ROLES as readonly string[]).includes(key);

export function staffIdentifier(email: string): string {
  return `${STAFF_IDENTIFIER_PREFIX}${normalizeIdentifier(email)}`;
}

/** The highest-ranked fixed staff role among `keys`, or `null` when none is held. */
export function highestStaffRole(keys: ReadonlySet<string>): StaffRole | null {
  let best: StaffRole | null = null;
  for (const key of keys) {
    if (isStaffRole(key) && (best === null || ROLE_RANK[key] > ROLE_RANK[best])) best = key;
  }
  return best;
}

/** One principal of the tenant, joined with everything the staff screens and guards ask about. */
export interface StaffEntry {
  readonly principal: PrincipalSummary;
  /** The `staff:` credential's email (an invitee has none yet — then the invitation's email). */
  readonly email: string;
  readonly hasCredential: boolean;
  /** Active role keys (any scope) of the principal right now. */
  readonly roleKeys: ReadonlySet<string>;
  readonly invitation: StaffInvitation | null;
  readonly isOwner: boolean;
}

export interface StaffDirectory {
  /** Every principal that counts as staff, keyed by externalId. Disabled principals never appear. */
  readonly staff: ReadonlyMap<string, StaffEntry>;
  /** Active principals holding `platform-admin` or `admin` — the "a store needs an admin" set. */
  readonly adminLevel: ReadonlySet<string>;
  /** Every principal summary of the tenant (any kind), by externalId — for actor lookups. */
  readonly principals: ReadonlyMap<string, PrincipalSummary>;
  /** Active role keys per INTERNAL principal id. */
  readonly rolesByInternalId: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * Reads the staff picture of a tenant through the tx-aware readers: principals, the `staff:`
 * credentials, the active assignments and the pending invitations. A principal is staff when it owns
 * a `staff:` credential AND holds one of the four staff keys, or has a pending invitation; disabled
 * principals and customers (no `staff:` credential) never are.
 */
export async function loadStaffDirectory(
  deps: StaffDeps,
  tenantId: string,
  now: Date,
  tx?: unknown,
): Promise<StaffDirectory> {
  const [summaries, credentials, activeAssignments, pending] = await Promise.all([
    deps.principalReader.listSummaries(tenantId, tx),
    deps.staffCredentials.listByPrefix(tenantId, STAFF_IDENTIFIER_PREFIX),
    deps.assignments.listActiveByTenant(tenantId, now, tx),
    deps.staffInvitations.listPending(tenantId, tx),
  ]);
  const principals = new Map<string, PrincipalSummary>();
  for (const p of summaries) principals.set(p.externalId, p);
  const rolesByInternalId = new Map<string, Set<string>>();
  for (const a of activeAssignments) {
    const keys = rolesByInternalId.get(a.principalRef) ?? new Set<string>();
    keys.add(a.roleKey);
    rolesByInternalId.set(a.principalRef, keys);
  }
  const emailByExternalId = new Map<string, string>();
  for (const c of credentials) {
    // The lowest identifier wins when a principal owns several credentials (deterministic).
    if (!emailByExternalId.has(c.principalExternalId))
      emailByExternalId.set(
        c.principalExternalId,
        c.identifier.slice(STAFF_IDENTIFIER_PREFIX.length),
      );
  }
  const invitationByExternalId = new Map<string, StaffInvitation>();
  for (const inv of pending) invitationByExternalId.set(inv.principalExternalId, inv);

  const staff = new Map<string, StaffEntry>();
  const adminLevel = new Set<string>();
  for (const principal of summaries) {
    if (principal.status === "disabled") continue;
    const credentialEmail = emailByExternalId.get(principal.externalId);
    const invitation = invitationByExternalId.get(principal.externalId) ?? null;
    const roleKeys = rolesByInternalId.get(principal.id) ?? new Set<string>();
    const holdsStaffKey = STAFF_ASSIGNMENT_KEYS.some((k) => roleKeys.has(k));
    const isStaff = (credentialEmail !== undefined && holdsStaffKey) || invitation !== null;
    if (!isStaff) continue;
    const email = credentialEmail ?? invitation?.email;
    if (email === undefined) continue;
    staff.set(principal.externalId, {
      principal,
      email,
      hasCredential: credentialEmail !== undefined,
      roleKeys,
      invitation,
      isOwner: roleKeys.has(OWNER_ROLE_KEY),
    });
  }
  for (const principal of summaries) {
    const roleKeys = rolesByInternalId.get(principal.id);
    if (
      principal.status === "active" &&
      roleKeys !== undefined &&
      (roleKeys.has(OWNER_ROLE_KEY) || roleKeys.has("admin"))
    )
      adminLevel.add(principal.externalId);
  }
  return { staff, adminLevel, principals, rolesByInternalId };
}

/**
 * Would these members still leave an admin-level principal? `removed` lose admin-level standing,
 * `added` gain it. Pure so the rule is testable on its own (the actor re-check normally already
 * guarantees one remaining admin; this is the defence in depth the plan asks for).
 */
export function adminsAfterChange(
  directory: Pick<StaffDirectory, "adminLevel">,
  change: { readonly removed?: string; readonly added?: string },
): number {
  const next = new Set(directory.adminLevel);
  if (change.removed !== undefined) next.delete(change.removed);
  if (change.added !== undefined) next.add(change.added);
  return next.size;
}

/**
 * Under the staff lock: the actor must still be an ACTIVE principal holding `platform-admin` or
 * `admin` (re-read, never trusted from the caller's earlier check) — else `AuthorizationError` (403).
 */
export async function requireActiveStaffAdmin(
  deps: StaffDeps,
  tenantId: string,
  actorExternalId: string,
  now: Date,
  tx: unknown,
): Promise<Principal> {
  const denied = new AuthorizationError("You don't have permission to manage staff");
  const actor = await deps.principals.findByExternalId(actorExternalId, tenantId, tx);
  if (actor === null || !actor.isActive) throw denied;
  const assignments = await deps.assignments.listByPrincipal(actor.id.toString(), tenantId, tx);
  const holds = assignments.some(
    (a) => a.isActiveAt(now) && (a.roleKey === OWNER_ROLE_KEY || a.roleKey === "admin"),
  );
  if (!holds) throw denied;
  return actor;
}

/**
 * Wave 1e — the store's "require two-step verification for everyone" flag: the SINGLE source every
 * reader uses (policy GET/SET, the 1d invite / accept / reactivate refusals, the own turn-off
 * refusal). It lives on the tenant profile keyed `tenantRef = tenantId` and binds STAFF only (through
 * `Authenticate.requireEnrolledFactor`); storefront customers never read it. A missing profile = off.
 */
export async function isTwoStepRequired(
  deps: Pick<StaffDeps, "tenantProfiles">,
  tenantId: string,
  tx?: unknown,
): Promise<boolean> {
  const profile = await deps.tenantProfiles.findByTenant(tenantId, tenantId, tx);
  return profile?.mfaRequired ?? false;
}

const ROLE_NAMES: Readonly<Record<StaffRole, string>> = {
  admin: "Admin",
  operator: "Operator",
  viewer: "Viewer",
};

/**
 * Defines the Security roles `admin`, `operator` and `viewer` when absent (no permissions —
 * authorisation stays in `RoleTableAccessControl`), so assignments always reference defined roles.
 * Idempotent; runs in the caller's transaction.
 */
export async function ensureStaffRoles(
  deps: StaffDeps,
  tenantId: string,
  tx: unknown,
): Promise<void> {
  for (const key of STAFF_ROLES) {
    const existing = await deps.roles.findByKey(key, tenantId, tx);
    if (existing !== null) continue;
    const role = Role.define(
      UniqueEntityId.from(deps.idGenerator.generate()),
      { key, name: ROLE_NAMES[key], permissions: [] },
      deps.idGenerator.generate(),
      deps.clock.now(),
    );
    await deps.roles.save(role, tenantId, tx);
    await recordAudit(deps, tx, {
      tenantId,
      principalRef: "system",
      action: "security.role.defined",
      decision: "allow",
      metadata: { role: key },
    });
  }
}

/**
 * One staff command = ONE unit of work + the tenant staff lock. The body throws domain errors for
 * every rejection (which rolls the Postgres transaction back and, because the body validates before
 * its first write, leaves the in-memory store untouched); they come back as an `err` result.
 */
export async function runStaffCommand<T>(
  deps: StaffDeps,
  tenantId: string,
  body: (tx: unknown) => Promise<T>,
): Promise<Result<T, DomainError>> {
  try {
    const value = await deps.unitOfWork.run((tx) =>
      deps.staffMutationLock.withTenantStaffLock(tenantId, tx, () => body(tx)),
    );
    return ok(value);
  } catch (error) {
    if (isDomainError(error)) return err(error);
    throw error;
  }
}
