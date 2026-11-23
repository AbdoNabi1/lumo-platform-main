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
    // The ninth new string (Part 2 pages): covered by `pages:*`, so operators and admins, not viewers.
    expect(await acl.authorize(who(["viewer"]), "pages:update_page")).toBe(false);
    expect(await acl.authorize(who(["operator"]), "pages:update_page")).toBe(true);
    expect(await acl.authorize(who(["admin"]), "pages:update_page")).toBe(true);
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

  it("leads inbox: viewers read only; operators read, change status and export; admins everything (Lead Site Part C)", async () => {
    const viewer = who(["viewer"]);
    const op = who(["operator"]);
    const admin = who(["admin"]);
    expect(await acl.authorize(viewer, "leads:read")).toBe(true);
    expect(await acl.authorize(viewer, "leads:update")).toBe(false);
    expect(await acl.authorize(viewer, "leads:export")).toBe(false);
    expect(await acl.authorize(op, "leads:read")).toBe(true);
    expect(await acl.authorize(op, "leads:update")).toBe(true);
    expect(await acl.authorize(op, "leads:export")).toBe(true);
    expect(await acl.authorize(admin, "leads:update")).toBe(true);
    expect(await acl.authorize(admin, "leads:export")).toBe(true);
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
