import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

const domainIdParams = z.object({ domainId: z.string().min(1) });
const addDomainBody = z.object({ hostname: z.string().min(3).max(253) }).strict();

/**
 * Merchant domains. Unlike the operator routes (`/tenants/:tenantId/domains`, pinned to the platform
 * tenant under `TENANT_MODE=multi`), these always act on `context.tenantId` — a client never names the
 * shop. A domain id belonging to another shop is a 404 and changes nothing.
 */
export function storeDomainsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/store/domains",
      version: 1,
      permission: "settings:read",
      summary: "The shop's domains (its platform subdomain and any custom domains)",
      schema: {},
      handle: ({ context }) => admin.tenancy.listMyDomains(context.principal, context.tenantId),
    }),
    defineRoute({
      method: "POST",
      path: "/store/domains",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary: "Add a custom domain to the shop (pending until its DNS is verified)",
      schema: { body: addDomainBody },
      handle: ({ body, context }) =>
        admin.tenancy.addMyDomain(context.principal, context.tenantId, body.hostname),
    }),
    defineRoute({
      method: "POST",
      path: "/store/domains/:domainId/verify",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary: "Verify that one of the shop's custom domains points at the platform",
      schema: { params: domainIdParams },
      handle: ({ params, context }) =>
        admin.tenancy.verifyMyDomain(context.principal, context.tenantId, params.domainId),
    }),
    defineRoute({
      method: "POST",
      path: "/store/domains/:domainId/primary",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary: "Make one of the shop's verified domains its primary",
      schema: { params: domainIdParams },
      handle: ({ params, context }) =>
        admin.tenancy.makeMyDomainPrimary(context.principal, context.tenantId, params.domainId),
    }),
  ] as readonly RouteDefinition[];
}
