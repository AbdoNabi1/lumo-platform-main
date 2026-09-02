import type { RoleRepository } from "../domain/repositories";
import type { Role } from "../domain/role";

/**
 * Loads the transitive closure of roles referenced by a set of assignment role keys (direct +
 * inherited parents), cycle-safe. Shared by every authorization path so RBAC resolution is defined
 * once (no duplicated closure logic across use-cases).
 */
export async function loadRoleClosure(
  roles: RoleRepository,
  assignmentKeys: readonly string[],
): Promise<Map<string, Role>> {
  const map = new Map<string, Role>();
  let frontier = [...new Set(assignmentKeys)];
  while (frontier.length > 0) {
    const found = await roles.findByKeys(frontier);
    const next: string[] = [];
    for (const role of found) {
      if (!map.has(role.key)) {
        map.set(role.key, role);
        if (role.parentKey !== null && !map.has(role.parentKey)) next.push(role.parentKey);
      }
    }
    frontier = [...new Set(next)].filter((k) => !map.has(k));
  }
  return map;
}
