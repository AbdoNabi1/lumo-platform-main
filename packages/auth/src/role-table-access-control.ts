import type { AccessControl, Permission, Principal } from "@platform/contracts";

/** Shop-data resources a viewer may read and an operator may change (Plan 1B-2). */
const SHOP_RESOURCES = [
  "products",
  "categories",
  "brands",
  "collections",
  "inventory",
  "warehouse",
  "pricing",
  "orders",
  "fulfillment",
  "shipping",
  "returns",
  "customers",
  "reviews",
  "promotions",
  "coupons",
  "media_library",
  "pages",
  "content",
  "components",
  "theme",
  "experience",
  "seo",
  "localization",
  "notifications",
] as const;

/** Read-only extras a viewer and operator may see (dashboards), never change. */
const READ_ONLY_RESOURCES = ["analytics", "reporting", "search", "recommendations"] as const;

/**
 * Plan 1B-2: Shopify-style fixed staff roles. Money (payments, finance), security, tenancy, billing
 * and feature administration stay admin-only. Granular per-staff permissions are a later plan.
 */
export const ROLE_PERMISSIONS = {
  admin: ["*:*"],
  operator: [
    ...SHOP_RESOURCES.map((r) => `${r}:*`),
    ...READ_ONLY_RESOURCES.map((r) => `${r}:read`),
  ],
  viewer: [...SHOP_RESOURCES, ...READ_ONLY_RESOURCES].map((r) => `${r}:read`),
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** The tenant baseline's owner role (services/security tenant-baseline.ts) is an admin. */
const ROLE_ALIASES: Readonly<Record<string, keyof typeof ROLE_PERMISSIONS>> = {
  "platform-admin": "admin",
  admin: "admin",
  operator: "operator",
  viewer: "viewer",
};

export function permissionMatches(granted: string, required: string): boolean {
  const [gResource, gAction] = granted.split(":");
  const [rResource, rAction] = required.split(":");
  if (gResource === undefined || gAction === undefined) return false;
  if (rResource === undefined || rAction === undefined) return false;
  return (gResource === "*" || gResource === rResource) && (gAction === "*" || gAction === rAction);
}

/** `AccessControl` over the role table. Only staff principals are considered. */
export class RoleTableAccessControl implements AccessControl {
  authorize(principal: Principal, permission: Permission): Promise<boolean> {
    if (principal.kind !== "staff") return Promise.resolve(false);
    const allowed = principal.roles.some((role) => {
      const canonical = ROLE_ALIASES[role];
      return (
        canonical !== undefined &&
        ROLE_PERMISSIONS[canonical].some((granted) => permissionMatches(granted, permission))
      );
    });
    return Promise.resolve(allowed);
  }
}
