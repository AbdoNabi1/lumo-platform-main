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

  it("online store: viewers read, operators edit, only admins publish and lock (Project 4)", async () => {
    const writes = [
      "online_store:update_preferences",
      "online_store:upload_image",
      "online_store:edit_theme",
      "online_store:manage_menus",
      "online_store:manage_policies",
    ];
    const adminOnly = ["online_store_admin:publish_theme", "online_store_admin:update_access"];
    for (const role of ["viewer", "operator", "admin"]) {
      expect(await acl.authorize(who([role]), "online_store:read"), role).toBe(true);
    }
    for (const permission of writes) {
      expect(await acl.authorize(who(["viewer"]), permission), permission).toBe(false);
      expect(await acl.authorize(who(["operator"]), permission), permission).toBe(true);
    }
    for (const permission of adminOnly) {
      expect(await acl.authorize(who(["viewer"]), permission), permission).toBe(false);
      expect(await acl.authorize(who(["operator"]), permission), permission).toBe(false);
      expect(await acl.authorize(who(["admin"]), permission), permission).toBe(true);
    }
  });
});
