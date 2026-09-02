import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { Theme } from "@platform/theme";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const pageQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});

export interface ThemeVersionDto {
  readonly versionNumber: number;
  readonly publishedAt: string;
}

export interface ThemeDto {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly colors: Readonly<Record<string, string>>;
  readonly typography: Readonly<Record<string, string>>;
  readonly spacing: Readonly<Record<string, string>>;
  readonly versions: readonly ThemeVersionDto[];
}

function toThemeDto(theme: Theme): ThemeDto {
  return {
    id: theme.id.toString(),
    name: theme.name,
    status: theme.status,
    colors: theme.variables.colors,
    typography: theme.variables.typography,
    spacing: theme.variables.spacing,
    versions: theme.versions.map((v) => ({
      versionNumber: v.versionNumber,
      publishedAt: v.publishedAt.toISOString(),
    })),
  };
}

const createThemeBody = z.object({ name: z.string().min(1), presetKey: z.string().min(1) });
const themeIdParams = z.object({ themeId: z.string().min(1) });
const advanceThemeBody = z.object({ toStatus: z.enum(["draft", "active", "archived"]) });
const updateThemeVariablesBody = z.object({
  colors: z.record(z.string()),
  typography: z.record(z.string()),
  spacing: z.record(z.string()),
});

/** The Theme System admin HTTP surface (Sprint 5.4). Pure delegation. */
export function themeRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/themes",
      version: 1,
      permission: "theme:create",
      idempotent: true,
      summary: "Create a theme, seeded from a frozen design-token preset",
      schema: { body: createThemeBody },
      handle: ({ body, context }) => admin.theme.create(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/themes/:themeId/transitions",
      version: 1,
      permission: "theme:advance",
      idempotent: true,
      summary: "Advance a theme's status",
      schema: { params: themeIdParams, body: advanceThemeBody },
      handle: ({ params, body, context }) =>
        admin.theme.advance(context.principal, { themeId: params.themeId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/themes/:themeId/variables",
      version: 1,
      permission: "theme:update_variables",
      idempotent: true,
      summary: "Update a draft theme's variables",
      schema: { params: themeIdParams, body: updateThemeVariablesBody },
      handle: ({ params, body, context }) =>
        admin.theme.updateVariables(context.principal, { themeId: params.themeId, ...body }),
    }),
    defineRoute({
      method: "GET",
      path: "/themes",
      version: 1,
      permission: "theme:read",
      summary: "List themes (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(await admin.theme.list(context.principal, query), toThemeDto),
    }),
    defineRoute({
      method: "GET",
      path: "/themes/:themeId",
      version: 1,
      permission: "theme:read",
      summary: "Get one theme by id",
      schema: { params: themeIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.theme.get(context.principal, params);
        if (response.status !== 200) return response;
        return { status: 200, body: toThemeDto(response.body as Theme) };
      },
    }),
  ] as readonly RouteDefinition[];
}
