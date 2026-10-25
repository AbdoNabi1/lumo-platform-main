import { describe, expect, it } from "vitest";
import type { Principal } from "@platform/contracts";
import { RoleTableAccessControl, permissionMatches } from "./role-table-access-control";

const who = (roles: string[]): Principal => ({ id: "s", kind: "staff", roles, tenantId: "t" });
const acl = new RoleTableAccessControl();

describe("permissionMatches", () => {
  it.each([
    ["*:*", "orders:refund", true],
    ["orders:*", "orders:refund", true],
    ["*:read", "finance:read", true],
    ["orders:read", "orders:read", true],
    ["orders:read", "orders:update", false],
    ["orders:*", "payments:refund", false],
    ["*:read", "orders:update", false],
  ])("%s grants %s → %s", (granted, required, expected) => {
    expect(permissionMatches(granted, required)).toBe(expected);
  });
});

describe("RoleTableAccessControl", () => {
  it("every staff role may change its own password; a customer may not (Plan 1C)", async () => {
    for (const role of ["admin", "operator", "viewer"]) {
      expect(await acl.authorize(who([role]), "account:update_self")).toBe(true);
    }
    const customer: Principal = { id: "c", kind: "customer", roles: ["viewer"], tenantId: "t" };
    expect(await acl.authorize(customer, "account:update_self")).toBe(false);
  });

  it("admin and platform-admin can do everything", async () => {
    expect(await acl.authorize(who(["admin"]), "security:manage")).toBe(true);
    expect(await acl.authorize(who(["platform-admin"]), "finance:create")).toBe(true);
  });

  it("operator runs the shop but cannot touch money, security or settings", async () => {
    const op = who(["operator"]);
    expect(await acl.authorize(op, "products:create")).toBe(true);
    expect(await acl.authorize(op, "orders:update")).toBe(true);
    expect(await acl.authorize(op, "inventory:reserve")).toBe(true);
    expect(await acl.authorize(op, "payments:refund")).toBe(false);
    expect(await acl.authorize(op, "security:manage")).toBe(false);
    expect(await acl.authorize(op, "finance:read")).toBe(false);
    expect(await acl.authorize(op, "tenancy:update")).toBe(false);
  });

  it("viewer only reads shop data", async () => {
    const viewer = who(["viewer"]);
    expect(await acl.authorize(viewer, "orders:read")).toBe(true);
    expect(await acl.authorize(viewer, "orders:update")).toBe(false);
    expect(await acl.authorize(viewer, "finance:read")).toBe(false);
  });

  it("no role, an unknown role, or a customer gets nothing", async () => {
    expect(await acl.authorize(who([]), "orders:read")).toBe(false);
    expect(await acl.authorize(who(["superuser"]), "orders:read")).toBe(false);
    expect(
      await acl.authorize(
        { id: "c", kind: "customer", roles: ["admin"], tenantId: "t" },
        "orders:read",
      ),
    ).toBe(false);
  });
  it("operators archive and export orders; viewers do neither; cash stays admin-only (orders Part 1)", async () => {
    const op = who(["operator"]);
    const viewer = who(["viewer"]);
    expect(await acl.authorize(op, "orders:archive")).toBe(true);
    expect(await acl.authorize(op, "orders:export")).toBe(true);
    expect(await acl.authorize(viewer, "orders:archive")).toBe(false);
    expect(await acl.authorize(viewer, "orders:export")).toBe(false);
    expect(await acl.authorize(viewer, "orders:read")).toBe(true);
    expect(await acl.authorize(op, "payments:confirm_cod_collection")).toBe(false);
    expect(await acl.authorize(who(["admin"]), "payments:confirm_cod_collection")).toBe(true);
  });
  it("operators and admins write notes, tags and comments; viewers only read; only admins moderate comments (orders Part 2)", async () => {
    const op = who(["operator"]);
    const viewer = who(["viewer"]);
    const admin = who(["admin"]);
    for (const permission of ["orders:edit_note", "orders:tag", "orders:comment"]) {
      expect(await acl.authorize(op, permission), permission).toBe(true);
      expect(await acl.authorize(admin, permission), permission).toBe(true);
      expect(await acl.authorize(viewer, permission), permission).toBe(false);
    }
    expect(await acl.authorize(op, "comments:moderate")).toBe(false);
    expect(await acl.authorize(viewer, "comments:moderate")).toBe(false);
    expect(await acl.authorize(admin, "comments:moderate")).toBe(true);
    expect(await acl.authorize(who(["platform-admin"]), "comments:moderate")).toBe(true);
  });
  it("operators and admins issue recovery links; viewers only read abandoned checkouts (orders Part 3)", async () => {
    expect(await acl.authorize(who(["operator"]), "orders:recover_checkout")).toBe(true);
    expect(await acl.authorize(who(["admin"]), "orders:recover_checkout")).toBe(true);
    expect(await acl.authorize(who(["platform-admin"]), "orders:recover_checkout")).toBe(true);
    expect(await acl.authorize(who(["viewer"]), "orders:recover_checkout")).toBe(false);
    expect(await acl.authorize(who(["viewer"]), "orders:read")).toBe(true);
  });
  it("operators and admins build and complete drafts; viewers only read them (orders Part 4)", async () => {
    for (const permission of ["orders:draft", "orders:complete_draft"]) {
      expect(await acl.authorize(who(["operator"]), permission), permission).toBe(true);
      expect(await acl.authorize(who(["admin"]), permission), permission).toBe(true);
      expect(await acl.authorize(who(["platform-admin"]), permission), permission).toBe(true);
      expect(await acl.authorize(who(["viewer"]), permission), permission).toBe(false);
    }
    // "Mark as paid" also needs the money permission, which stays admin-only.
    expect(await acl.authorize(who(["operator"]), "payments:confirm_cod_collection")).toBe(false);
  });
});
