import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { AuthorizationEvaluator } from "./authorization";
import { Role } from "./role";
import { RoleAssignment } from "./role-assignment";
import { PermissionSpec } from "./value-objects/permission-spec";
import { SecurityScope } from "./value-objects/security-scope";

const now = new Date("2026-07-17T00:00:00.000Z");
let counter = 0;
const id = (): UniqueEntityId => UniqueEntityId.from(`id-${(counter += 1)}`);
const perm = (p: string): PermissionSpec => {
  const spec = PermissionSpec.parse(p);
  if (!spec.ok) throw new Error(p);
  return spec.value;
};

describe("AuthorizationEvaluator (RBAC + inheritance + scope)", () => {
  it("resolves inherited permissions through parent roles", () => {
    const base = Role.define(
      id(),
      { key: "base", name: "Base", permissions: ["catalog:read"] },
      "e",
      now,
    );
    const editor = Role.define(
      id(),
      { key: "editor", name: "Editor", parentKey: "base", permissions: ["catalog:write"] },
      "e",
      now,
    );
    const assignment = RoleAssignment.grant(
      id(),
      { principalRef: "p1", roleKey: "editor", grantedBy: "admin" },
      "e",
      now,
    );
    const roles = new Map([
      ["base", base],
      ["editor", editor],
    ]);

    const evaluator = new AuthorizationEvaluator();
    const effective = evaluator.resolve({
      assignments: [assignment],
      roles,
      requestScope: SecurityScope.platform(),
      now,
    });

    expect(evaluator.isAuthorized(effective, perm("catalog:read"))).toBe(true);
    expect(evaluator.isAuthorized(effective, perm("catalog:write"))).toBe(true);
    expect(evaluator.isAuthorized(effective, perm("orders:delete"))).toBe(false);
    expect([...effective.roleKeys].sort()).toEqual(["base", "editor"]);
  });

  it("honours wildcard permissions", () => {
    const admin = Role.define(
      id(),
      { key: "admin", name: "Admin", permissions: ["orders:*"] },
      "e",
      now,
    );
    const assignment = RoleAssignment.grant(
      id(),
      { principalRef: "p1", roleKey: "admin", grantedBy: "sys" },
      "e",
      now,
    );
    const evaluator = new AuthorizationEvaluator();
    const effective = evaluator.resolve({
      assignments: [assignment],
      roles: new Map([["admin", admin]]),
      requestScope: SecurityScope.platform(),
      now,
    });
    expect(evaluator.isAuthorized(effective, perm("orders:refund"))).toBe(true);
  });

  it("respects scope containment — a tenant grant does not authorize another tenant", () => {
    const role = Role.define(
      id(),
      { key: "mgr", name: "Manager", permissions: ["catalog:write"] },
      "e",
      now,
    );
    const assignment = RoleAssignment.grant(
      id(),
      { principalRef: "p1", roleKey: "mgr", grantedBy: "sys", scope: { tenant: "t1" } },
      "e",
      now,
    );
    const roles = new Map([["mgr", role]]);
    const evaluator = new AuthorizationEvaluator();

    const inTenant = evaluator.resolve({
      assignments: [assignment],
      roles,
      requestScope: SecurityScope.tenant("t1"),
      now,
    });
    const otherTenant = evaluator.resolve({
      assignments: [assignment],
      roles,
      requestScope: SecurityScope.tenant("t2"),
      now,
    });

    expect(evaluator.isAuthorized(inTenant, perm("catalog:write"))).toBe(true);
    expect(evaluator.isAuthorized(otherTenant, perm("catalog:write"))).toBe(false);
  });

  it("excludes expired (JIT) assignments", () => {
    const role = Role.define(id(), { key: "r", name: "R", permissions: ["a:b"] }, "e", now);
    const expired = RoleAssignment.grant(
      id(),
      {
        principalRef: "p1",
        roleKey: "r",
        grantedBy: "sys",
        expiresAt: new Date(now.getTime() + 1000),
      },
      "e",
      now,
    );
    const evaluator = new AuthorizationEvaluator();
    const later = new Date(now.getTime() + 5000);
    const effective = evaluator.resolve({
      assignments: [expired],
      roles: new Map([["r", role]]),
      requestScope: SecurityScope.platform(),
      now: later,
    });
    expect(evaluator.isAuthorized(effective, perm("a:b"))).toBe(false);
  });
});
