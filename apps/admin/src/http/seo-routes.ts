import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { Redirect, RobotsPolicy, SeoProfile, Sitemap } from "@platform/seo";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const pageQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});
const profileIdParams = z.object({ profileId: z.string().min(1) });
const redirectIdParams = z.object({ redirectId: z.string().min(1) });
const policyIdParams = z.object({ policyId: z.string().min(1) });

export interface SeoProfileDto {
  readonly id: string;
  readonly pageRef: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly canonicalUrl: string | null;
  readonly ogImageRef: string | null;
}

function toSeoProfileDto(profile: SeoProfile): SeoProfileDto {
  return {
    id: profile.id.toString(),
    pageRef: profile.pageRef,
    title: profile.metadata.title ?? null,
    description: profile.metadata.description ?? null,
    canonicalUrl: profile.metadata.canonicalUrl ?? null,
    ogImageRef: profile.metadata.ogImageRef ?? null,
  };
}

export interface RedirectDto {
  readonly id: string;
  readonly fromPath: string;
  readonly toPath: string;
  readonly statusCode: number;
  readonly active: boolean;
}

function toRedirectDto(redirect: Redirect): RedirectDto {
  return {
    id: redirect.id.toString(),
    fromPath: redirect.fromPath,
    toPath: redirect.toPath,
    statusCode: redirect.statusCode,
    active: redirect.active,
  };
}

export interface SitemapDto {
  readonly id: string;
  readonly name: string;
  readonly urls: readonly string[];
  readonly lastGeneratedAt: string | null;
}

function toSitemapDto(sitemap: Sitemap): SitemapDto {
  return {
    id: sitemap.id.toString(),
    name: sitemap.name,
    urls: sitemap.urls,
    lastGeneratedAt: sitemap.lastGeneratedAt?.toISOString() ?? null,
  };
}

export interface RobotsPolicyDto {
  readonly id: string;
  readonly userAgent: string;
  readonly rules: readonly { readonly type: "allow" | "disallow"; readonly path: string }[];
}

function toRobotsPolicyDto(policy: RobotsPolicy): RobotsPolicyDto {
  return {
    id: policy.id.toString(),
    userAgent: policy.userAgent,
    rules: policy.rules,
  };
}

const setSeoProfileBody = z.object({
  pageRef: z.string().min(1),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  canonicalUrl: z.string().min(1).optional(),
  ogImageRef: z.string().min(1).optional(),
});
const createRedirectBody = z.object({
  fromPath: z.string().min(1),
  toPath: z.string().min(1),
  statusCode: z.union([z.literal(301), z.literal(302)]),
});
const createSitemapBody = z.object({ name: z.string().min(1) });
const sitemapIdParams = z.object({ sitemapId: z.string().min(1) });
const regenerateSitemapBody = z.object({ urls: z.array(z.string().min(1)) });
const setRobotsPolicyBody = z.object({
  userAgent: z.string().min(1),
  rules: z.array(z.object({ type: z.enum(["allow", "disallow"]), path: z.string().min(1) })),
});

/** The SEO admin HTTP surface (Sprint 5.4). Pure delegation. */
export function seoRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/seo/profiles",
      version: 1,
      permission: "seo:set_profile",
      idempotent: true,
      summary: "Create or update a page's SEO profile",
      schema: { body: setSeoProfileBody },
      handle: ({ body, context }) => admin.seo.setSeoProfile(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/seo/redirects",
      version: 1,
      permission: "seo:create_redirect",
      idempotent: true,
      summary: "Create a redirect rule",
      schema: { body: createRedirectBody },
      handle: ({ body, context }) => admin.seo.createRedirect(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/seo/sitemaps",
      version: 1,
      permission: "seo:create_sitemap",
      idempotent: true,
      summary: "Create a sitemap",
      schema: { body: createSitemapBody },
      handle: ({ body, context }) => admin.seo.createSitemap(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/seo/sitemaps/:sitemapId/regenerate",
      version: 1,
      permission: "seo:regenerate_sitemap",
      idempotent: true,
      summary: "Regenerate a sitemap's URL list",
      schema: { params: sitemapIdParams, body: regenerateSitemapBody },
      handle: ({ params, body, context }) =>
        admin.seo.regenerateSitemap(context.principal, { sitemapId: params.sitemapId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/seo/robots-policies",
      version: 1,
      permission: "seo:set_robots_policy",
      idempotent: true,
      summary: "Create or update a robots policy",
      schema: { body: setRobotsPolicyBody },
      handle: ({ body, context }) => admin.seo.setRobotsPolicy(context.principal, body),
    }),
    defineRoute({
      method: "GET",
      path: "/seo/profiles",
      version: 1,
      permission: "seo:read",
      summary: "List SEO profiles (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(await admin.seo.listSeoProfiles(context.principal, query), toSeoProfileDto),
    }),
    defineRoute({
      method: "GET",
      path: "/seo/profiles/:profileId",
      version: 1,
      permission: "seo:read",
      summary: "Get one SEO profile by id",
      schema: { params: profileIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.seo.getSeoProfile(context.principal, params);
        if (response.status !== 200) return response;
        return { status: 200, body: toSeoProfileDto(response.body as SeoProfile) };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/seo/redirects",
      version: 1,
      permission: "seo:read",
      summary: "List redirects (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(await admin.seo.listRedirects(context.principal, query), toRedirectDto),
    }),
    defineRoute({
      method: "GET",
      path: "/seo/redirects/:redirectId",
      version: 1,
      permission: "seo:read",
      summary: "Get one redirect by id",
      schema: { params: redirectIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.seo.getRedirect(context.principal, params);
        if (response.status !== 200) return response;
        return { status: 200, body: toRedirectDto(response.body as Redirect) };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/seo/sitemaps",
      version: 1,
      permission: "seo:read",
      summary: "List sitemaps (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(await admin.seo.listSitemaps(context.principal, query), toSitemapDto),
    }),
    defineRoute({
      method: "GET",
      path: "/seo/sitemaps/:sitemapId",
      version: 1,
      permission: "seo:read",
      summary: "Get one sitemap by id",
      schema: { params: sitemapIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.seo.getSitemap(context.principal, params);
        if (response.status !== 200) return response;
        return { status: 200, body: toSitemapDto(response.body as Sitemap) };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/seo/robots-policies",
      version: 1,
      permission: "seo:read",
      summary: "List robots policies (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(await admin.seo.listRobotsPolicies(context.principal, query), toRobotsPolicyDto),
    }),
    defineRoute({
      method: "GET",
      path: "/seo/robots-policies/:policyId",
      version: 1,
      permission: "seo:read",
      summary: "Get one robots policy by id",
      schema: { params: policyIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.seo.getRobotsPolicy(context.principal, params);
        if (response.status !== 200) return response;
        return { status: 200, body: toRobotsPolicyDto(response.body as RobotsPolicy) };
      },
    }),
  ] as readonly RouteDefinition[];
}
