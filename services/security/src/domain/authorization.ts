import type { Role } from "./role";
import type { RoleAssignment } from "./role-assignment";
import { PermissionSpec } from "./value-objects/permission-spec";
import type { SecurityScope } from "./value-objects/security-scope";

export interface AuthorizationRequest {
  readonly assignments: readonly RoleAssignment[];
  /** All roles referenced by the assignments (and their ancestors), keyed by role key. */
  readonly roles: ReadonlyMap<string, Role>;
  readonly requestScope: SecurityScope;
  readonly now: Date;
}

export interface EffectiveAuthorization {
  readonly permissions: readonly PermissionSpec[];
  /** The role keys that contributed (direct + inherited), for policy explanation/trace. */
  readonly roleKeys: readonly string[];
}

/**
 * The **authorization evaluator** — resolves a principal's *effective* permissions from active role
 * assignments, honouring **scope containment** and **role inheritance** (parent roles), then answers
 * RBAC checks. Pure and deterministic (no I/O): the application layer loads the assignments + roles
 * and passes them in. ABAC conditions layer on via policy; ReBAC via the resource model (ADR-0023,
 * sprint Part 2).
 */
export class AuthorizationEvaluator {
  resolve(request: AuthorizationRequest): EffectiveAuthorization {
    const permissions = new Map<string, PermissionSpec>();
    const roleKeys = new Set<string>();
    for (const assignment of request.assignments) {
      if (!assignment.isActiveAt(request.now)) continue;
      if (!assignment.scope.contains(request.requestScope)) continue;
      this.collectRole(assignment.roleKey, request.roles, roleKeys, permissions, new Set<string>());
    }
    return { permissions: [...permissions.values()], roleKeys: [...roleKeys] };
  }

  /** True when the effective permission set satisfies the required permission (wildcards widen). */
  isAuthorized(effective: EffectiveAuthorization, required: PermissionSpec): boolean {
    return effective.permissions.some((held) => held.implies(required));
  }

  private collectRole(
    key: string,
    roles: ReadonlyMap<string, Role>,
    roleKeys: Set<string>,
    permissions: Map<string, PermissionSpec>,
    seen: Set<string>,
  ): void {
    if (seen.has(key)) return; // cycle-safe inheritance walk
    seen.add(key);
    const role = roles.get(key);
    if (role === undefined || role.status !== "active") return;
    roleKeys.add(role.key);
    for (const permission of role.permissions) {
      const spec = PermissionSpec.parse(permission);
      if (spec.ok) permissions.set(spec.value.toString(), spec.value);
    }
    if (role.parentKey !== null) {
      this.collectRole(role.parentKey, roles, roleKeys, permissions, seen);
    }
  }
}
