import type { AccessControl, Clock, Permission, Principal } from "@platform/contracts";
import { OWNER_ROLE_KEY, type SecurityController } from "@platform/security";
import { TOKEN_ROLE } from "./staff-auth.admin-controller";

/** What the live check knows about one staff member right now. */
export interface StaffAccessSnapshot {
  /** The principal exists and is `active` (a suspended or disabled member is not). */
  readonly active: boolean;
  /** Token role names (admin | operator | viewer) the member holds now, mapped through `TOKEN_ROLE`. */
  readonly roles: readonly string[];
  /** The raw Security role keys the member holds now (`platform-admin` marks the store owner). */
  readonly roleKeys: readonly string[];
}

export interface StaffAccessReader {
  /** `null` when the principal does not exist in that tenant. A rejection means "unknown": fail closed. */
  read(tenantId: string, principalExternalId: string): Promise<StaffAccessSnapshot | null>;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * R5: resources that only the store owner (the `platform-admin` holder) may use. An invited admin must not
 * be able to grant `platform-admin`, revoke the owner or transition principals through the security
 * console or the legacy provisioning routes.
 */
const OWNER_ONLY_RESOURCES: ReadonlySet<string> = new Set([
  "security",
  "users",
  "memberships",
  "organizations",
]);

/** The public sign-in permission is never an owner-only decision (O4). */
const EXEMPT_PERMISSIONS: ReadonlySet<string> = new Set(["security:authenticate"]);

export interface LiveStaffAccessControlDeps {
  readonly inner: AccessControl;
  readonly reader: StaffAccessReader;
  readonly clock: Clock;
  /** How long a snapshot may be reused; default 30 000 ms (D13: changes bite within 30 seconds). */
  readonly ttlMs?: number;
  readonly maxEntries?: number;
  /**
   * `false` makes the control a plain pass-through to `inner` (no lookup, no owner-only rule). The live check
   * reads Security's own principal and role tables, which are the source of truth for staff only under
   * NATIVE sign-in; with an external identity provider (Ory/Keto) staff ids and roles live there and a
   * Security lookup would lock every staff member out. Default `true`.
   */
  readonly enabled?: boolean;
}

interface CacheEntry {
  readonly snapshot: StaffAccessSnapshot | null;
  readonly expiresAt: number;
}

/**
 * D13: wraps the admin access control with a LIVE look at the staff member behind a token. A token's roles
 * were true when it was issued; this asks Security who the member is NOW (cached for 30 s, dropped at once
 * by `invalidate` on the instance that made the change). The token can only narrow, never widen: its roles
 * are filtered down to the ones the member still holds. One instance backs BOTH guards (the facade
 * `AdminGuard` and the HTTP `AdminGuard`). Non-staff principals (customers, services) pass straight through.
 */
export class LiveStaffAccessControl implements AccessControl {
  private readonly inner: AccessControl;
  private readonly reader: StaffAccessReader;
  private readonly clock: Clock;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly enabled: boolean;
  private readonly cache = new Map<string, CacheEntry>();
  /** Bumped by every `invalidate`, so a read that started before it never caches its (stale) answer. */
  private epoch = 0;

  constructor(deps: LiveStaffAccessControlDeps) {
    this.inner = deps.inner;
    this.reader = deps.reader;
    this.clock = deps.clock;
    this.ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = deps.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.enabled = deps.enabled ?? true;
  }

  async authorize(principal: Principal, permission: Permission): Promise<boolean> {
    if (!this.enabled || principal.kind !== "staff")
      return this.inner.authorize(principal, permission);
    let snapshot: StaffAccessSnapshot | null;
    try {
      snapshot = await this.snapshotOf(principal.tenantId, principal.id);
    } catch {
      return false; // fail closed; nothing was cached, the next call asks again
    }
    if (snapshot === null || !snapshot.active) return false;
    if (isOwnerOnly(permission) && !snapshot.roleKeys.includes(OWNER_ROLE_KEY)) return false;

    return this.inner.authorize(
      { ...principal, roles: principal.roles.filter((role) => snapshot.roles.includes(role)) },
      permission,
    );
  }

  /** Forget what is known about one member (after a role change, deactivation or revoke). */
  invalidate(tenantId: string, principalExternalId: string): void {
    this.epoch += 1;
    this.cache.delete(keyOf(tenantId, principalExternalId));
  }

  private async snapshotOf(
    tenantId: string,
    principalExternalId: string,
  ): Promise<StaffAccessSnapshot | null> {
    const key = keyOf(tenantId, principalExternalId);
    const now = this.clock.now().getTime();
    const hit = this.cache.get(key);
    if (hit !== undefined && hit.expiresAt > now) return hit.snapshot;
    const epochAtStart = this.epoch;
    const snapshot = await this.reader.read(tenantId, principalExternalId);
    if (epochAtStart === this.epoch) {
      this.cache.delete(key); // re-insert so the refreshed entry counts as the newest
      this.cache.set(key, { snapshot, expiresAt: this.clock.now().getTime() + this.ttlMs });
      while (this.cache.size > this.maxEntries) {
        const oldest = this.cache.keys().next();
        if (oldest.done === true) break;
        this.cache.delete(oldest.value);
      }
    }
    return snapshot;
  }
}

function keyOf(tenantId: string, principalExternalId: string): string {
  return `${tenantId}\u0000${principalExternalId}`;
}

function isOwnerOnly(permission: Permission): boolean {
  if (EXEMPT_PERMISSIONS.has(permission)) return false;
  const resource = permission.split(":")[0] ?? "";
  return OWNER_ONLY_RESOURCES.has(resource);
}

/**
 * O1: the reader backed by Security's `staffAccess` read. 404 -> `null`; `active` -> `active: true`; the
 * token roles come from the SAME `TOKEN_ROLE` table the sign-in uses; the raw keys are kept for R5. Any
 * other answer (or a rejection) throws so the control fails closed.
 */
export function securityStaffAccessReader(
  security: Pick<SecurityController, "staffAccess">,
): StaffAccessReader {
  return {
    read: async (tenantId, principalExternalId) => {
      const response = await security.staffAccess({ tenantId, principalExternalId });
      if (response.status === 404) return null;
      if (response.status !== 200) {
        throw new Error(`staff access read failed with status ${response.status}`);
      }
      const body = response.body as {
        readonly status: string;
        readonly roleKeys: readonly string[];
      };
      const roles = [
        ...new Set(
          body.roleKeys
            .map((key) => TOKEN_ROLE[key])
            .filter((role): role is string => role !== undefined),
        ),
      ];
      return { active: body.status === "active", roles, roleKeys: [...body.roleKeys] };
    },
  };
}
