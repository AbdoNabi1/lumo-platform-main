import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import { AuthorizationError } from "@platform/utils";
import type { Tenant, Workspace } from "@platform/tenancy";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const pageQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});

export interface TenantDto {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: string;
  readonly isolationTier: string;
  readonly branding: Readonly<Record<string, string>>;
  readonly subscriptionRef: string | null;
}

function toTenantDto(tenant: Tenant): TenantDto {
  return {
    id: tenant.id.toString(),
    slug: tenant.slug.value,
    name: tenant.name,
    status: tenant.status,
    isolationTier: tenant.isolationTier,
    branding: tenant.branding,
    subscriptionRef: tenant.subscriptionRef ?? null,
  };
}

export interface WorkspaceDto {
  readonly id: string;
  readonly tenantRef: string;
  readonly env: string;
  readonly name: string;
  readonly status: string;
  readonly config: {
    readonly themeRef: string | null;
    readonly branding: Readonly<Record<string, string>> | null;
    readonly logoRef: string | null;
    readonly customDomain: string | null;
    readonly locale: string | null;
    readonly currency: string | null;
    readonly timezone: string | null;
    readonly markets: readonly string[] | null;
    readonly defaultLanguage: string | null;
    readonly regionalSettings: Readonly<Record<string, string>> | null;
  };
}

function toWorkspaceDto(workspace: Workspace): WorkspaceDto {
  return {
    id: workspace.id.toString(),
    tenantRef: workspace.tenantRef,
    env: workspace.env,
    name: workspace.name,
    status: workspace.status,
    config: {
      themeRef: workspace.config.themeRef ?? null,
      branding: workspace.config.branding ?? null,
      logoRef: workspace.config.logoRef ?? null,
      customDomain: workspace.config.customDomain ?? null,
      locale: workspace.config.locale ?? null,
      currency: workspace.config.currency ?? null,
      timezone: workspace.config.timezone ?? null,
      markets: workspace.config.markets ?? null,
      defaultLanguage: workspace.config.defaultLanguage ?? null,
      regionalSettings: workspace.config.regionalSettings ?? null,
    },
  };
}

const createTenantBody = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  isolationTier: z.enum(["pooled", "dedicated_schema", "dedicated_db"]),
});
const tenantIdParams = z.object({ tenantId: z.string().min(1) });
const rebrandTenantBody = z.object({ branding: z.record(z.string(), z.string()) });
const createWorkspaceBody = z.object({
  tenantId: z.string().min(1),
  env: z.enum(["production", "staging", "development"]),
  name: z.string().min(1),
});
const workspaceIdParams = z.object({ workspaceId: z.string().min(1) });
const configureWorkspaceBody = z.object({
  config: z.object({
    themeRef: z.string().optional(),
    branding: z.record(z.string(), z.string()).optional(),
    logoRef: z.string().optional(),
    customDomain: z.string().optional(),
    locale: z.string().optional(),
    currency: z.string().optional(),
    timezone: z.string().optional(),
    markets: z.array(z.string()).optional(),
    defaultLanguage: z.string().optional(),
    regionalSettings: z.record(z.string(), z.string()).optional(),
  }),
});

/** The Tenancy admin HTTP surface (Sprint 5.5/5.6). Pure delegation. */
export function tenancyRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/tenants",
      version: 1,
      permission: "tenancy:create",
      idempotent: true,
      summary: "Create a tenant",
      schema: { body: createTenantBody },
      handle: ({ body, context }) => admin.tenancy.createTenant(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/tenants/:tenantId/activate",
      version: 1,
      permission: "tenancy:update",
      idempotent: true,
      summary: "Activate a tenant",
      schema: { params: tenantIdParams },
      handle: ({ params, context }) => admin.tenancy.activateTenant(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/tenants/:tenantId/suspend",
      version: 1,
      permission: "tenancy:update",
      idempotent: true,
      summary: "Suspend a tenant",
      schema: { params: tenantIdParams },
      handle: ({ params, context }) => admin.tenancy.suspendTenant(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/tenants/:tenantId/cancel",
      version: 1,
      permission: "tenancy:update",
      idempotent: true,
      summary: "Cancel a tenant",
      schema: { params: tenantIdParams },
      handle: ({ params, context }) => admin.tenancy.cancelTenant(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/tenants/:tenantId/rebrand",
      version: 1,
      permission: "tenancy:update",
      idempotent: true,
      summary: "Rebrand a tenant",
      schema: { params: tenantIdParams, body: rebrandTenantBody },
      handle: ({ params, body, context }) =>
        admin.tenancy.rebrandTenant(context.principal, { ...params, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/workspaces",
      version: 1,
      permission: "tenancy:create",
      idempotent: true,
      summary: "Create a workspace",
      schema: { body: createWorkspaceBody },
      handle: ({ body, context }) => admin.tenancy.createWorkspace(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/workspaces/:workspaceId/archive",
      version: 1,
      permission: "tenancy:update",
      idempotent: true,
      summary: "Archive a workspace",
      schema: { params: workspaceIdParams },
      handle: ({ params, context }) => admin.tenancy.archiveWorkspace(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/workspaces/:workspaceId/configure",
      version: 1,
      permission: "tenancy:update",
      idempotent: true,
      summary: "Patch-configure a workspace's white-label settings",
      schema: { params: workspaceIdParams, body: configureWorkspaceBody },
      handle: ({ params, body, context }) =>
        admin.tenancy.configureWorkspace(context.principal, { ...params, ...body }),
    }),
    defineRoute({
      method: "GET",
      path: "/tenants",
      version: 1,
      permission: "tenancy:read",
      summary: "List tenants (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(await admin.tenancy.listTenants(context.principal, query), toTenantDto),
    }),
    defineRoute({
      method: "GET",
      path: "/tenants/:tenantId",
      version: 1,
      permission: "tenancy:read",
      summary: "Get one tenant by id",
      schema: { params: tenantIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.tenancy.getTenant(context.principal, params);
        if (response.status !== 200) return response;
        return { status: 200, body: toTenantDto(response.body as Tenant) };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/workspaces/current",
      version: 1,
      permission: "tenancy:read",
      summary: "Get the current tenant's workspace, resolved from the pinned request tenant",
      schema: {},
      handle: async ({ context }) => {
        const response = await admin.tenancy.getCurrentWorkspace(context.principal);
        if (response.status !== 200) return response;
        return { status: 200, body: toWorkspaceDto(response.body as Workspace) };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/workspaces",
      version: 1,
      permission: "tenancy:read",
      summary: "List workspaces (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(await admin.tenancy.listWorkspaces(context.principal, query), toWorkspaceDto),
    }),
    defineRoute({
      method: "GET",
      path: "/workspaces/:workspaceId",
      version: 1,
      permission: "tenancy:read",
      summary: "Get one workspace by id",
      schema: { params: workspaceIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.tenancy.getWorkspace(context.principal, params);
        if (response.status !== 200) return response;
        return { status: 200, body: toWorkspaceDto(response.body as Workspace) };
      },
    }),
  ] as readonly RouteDefinition[];
}

/**
 * TENANT_MODE=multi only (ADR-0014 point 8f). The tenancy context is the one recorded exemption from
 * per-request scoping: every `Tenant` row is scoped to the deployment tenant it was constructed with,
 * because a `Tenant` is platform-operator data and the operator identity that should own that scope
 * does not exist yet. Left unguarded, a request resolved to tenant B would read and write tenant
 * A's (the deployment tenant's) rows through these routes. So each handler refuses any request
 * whose resolved tenant is not the pinned one — fail closed, until 8a-8d let this list go away.
 */
export function pinRoutesToTenant(
  routes: readonly RouteDefinition[],
  pinnedTenantId: string,
): readonly RouteDefinition[] {
  return routes.map((route) => ({
    ...route,
    handle: (args) => {
      if (args.context.tenantId !== pinnedTenantId) {
        throw new AuthorizationError(
          "Tenant administration is restricted to the platform-operator scope " +
            "(ADR-0014 point 8f); this tenant may not use it.",
        );
      }
      return route.handle(args);
    },
  }));
}
