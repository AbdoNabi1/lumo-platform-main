import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { Page, Template } from "@platform/pages";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const pageQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});

export interface PageDto {
  readonly id: string;
  readonly name: string;
  readonly routePath: string;
  readonly templateRef: string | null;
  readonly experienceRef: string | null;
  readonly seoProfileRef: string | null;
  readonly localeRef: string | null;
  readonly status: string;
}

function toPageDto(page: Page): PageDto {
  return {
    id: page.id.toString(),
    name: page.name,
    routePath: page.routePath.value,
    templateRef: page.templateRef ?? null,
    experienceRef: page.experienceRef ?? null,
    seoProfileRef: page.seoProfileRef ?? null,
    localeRef: page.localeRef ?? null,
    status: page.status,
  };
}

export interface TemplateDto {
  readonly id: string;
  readonly name: string;
  readonly experienceRef: string;
  readonly status: string;
}

function toTemplateDto(template: Template): TemplateDto {
  return {
    id: template.id.toString(),
    name: template.name,
    experienceRef: template.experienceRef,
    status: template.status,
  };
}

const createPageBody = z.object({
  name: z.string().min(1),
  routePath: z.string().min(1),
  templateRef: z.string().min(1).optional(),
  experienceRef: z.string().min(1).optional(),
  seoProfileRef: z.string().min(1).optional(),
  localeRef: z.string().min(1).optional(),
});
const pageIdParams = z.object({ pageId: z.string().min(1) });
const advancePageBody = z.object({ toStatus: z.enum(["draft", "published", "archived"]) });
const createTemplateBody = z.object({ name: z.string().min(1), experienceRef: z.string().min(1) });
const templateIdParams = z.object({ templateId: z.string().min(1) });

/** The Dynamic Pages admin HTTP surface (Sprint 5.4). Pure delegation. */
export function pagesRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/pages",
      version: 1,
      permission: "pages:create_page",
      idempotent: true,
      summary: "Create a page",
      schema: { body: createPageBody },
      handle: ({ body, context }) =>
        admin.pages.createPage(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/pages/:pageId/transitions",
      version: 1,
      permission: "pages:advance_page",
      idempotent: true,
      summary: "Advance a page's status",
      schema: { params: pageIdParams, body: advancePageBody },
      handle: ({ params, body, context }) =>
        admin.pages.advancePage(context.principal, {
          pageId: params.pageId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/templates",
      version: 1,
      permission: "pages:create_template",
      idempotent: true,
      summary: "Create a reusable template",
      schema: { body: createTemplateBody },
      handle: ({ body, context }) =>
        admin.pages.createTemplate(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/templates/:templateId/archive",
      version: 1,
      permission: "pages:archive_template",
      idempotent: true,
      summary: "Archive a template",
      schema: { params: templateIdParams },
      handle: ({ params, context }) =>
        admin.pages.archiveTemplate(context.principal, {
          ...params,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/pages",
      version: 1,
      permission: "pages:read",
      summary: "List pages (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(
          await admin.pages.listPages(context.principal, {
            ...query,
            tenantId: context.tenantId,
          }),
          toPageDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/pages/:pageId",
      version: 1,
      permission: "pages:read",
      summary: "Get one page by id",
      schema: { params: pageIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.pages.getPage(context.principal, {
          ...params,
          tenantId: context.tenantId,
        });
        if (response.status !== 200) return response;
        return { status: 200, body: toPageDto(response.body as Page) };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/templates",
      version: 1,
      permission: "pages:read",
      summary: "List templates (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(
          await admin.pages.listTemplates(context.principal, {
            ...query,
            tenantId: context.tenantId,
          }),
          toTemplateDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/templates/:templateId",
      version: 1,
      permission: "pages:read",
      summary: "Get one template by id",
      schema: { params: templateIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.pages.getTemplate(context.principal, {
          ...params,
          tenantId: context.tenantId,
        });
        if (response.status !== 200) return response;
        return { status: 200, body: toTemplateDto(response.body as Template) };
      },
    }),
  ] as readonly RouteDefinition[];
}
