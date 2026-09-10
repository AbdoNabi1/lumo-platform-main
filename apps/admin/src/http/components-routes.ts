import { z } from "zod";
import type { ComponentDefinition } from "@platform/components";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const pageQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});

export interface ComponentDefinitionDto {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly properties: readonly {
    readonly name: string;
    readonly type: string;
    readonly required: boolean;
  }[];
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly slots: readonly string[];
  readonly events: readonly string[];
  readonly responsive: boolean;
  readonly permission: string | null;
  readonly featureFlagKey: string | null;
  readonly status: string;
}

function toComponentDefinitionDto(definition: ComponentDefinition): ComponentDefinitionDto {
  return {
    id: definition.id.toString(),
    key: definition.key,
    name: definition.name,
    properties: definition.schema.properties,
    defaults: definition.schema.defaults,
    slots: definition.contract.slots,
    events: definition.contract.events,
    responsive: definition.contract.responsive,
    permission: definition.contract.permission ?? null,
    featureFlagKey: definition.featureFlagKey ?? null,
    status: definition.status,
  };
}

const createComponentDefinitionBody = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  properties: z.array(
    z.object({
      name: z.string().min(1),
      type: z.enum(["string", "number", "boolean", "object", "array"]),
      required: z.boolean(),
    }),
  ),
  defaults: z.record(z.unknown()).optional(),
  slots: z.array(z.string().min(1)),
  events: z.array(z.string().min(1)),
  responsive: z.boolean(),
  permission: z.string().min(1).optional(),
  featureFlagKey: z.string().min(1).optional(),
});
const componentDefinitionIdParams = z.object({ componentDefinitionId: z.string().min(1) });
const advanceComponentDefinitionBody = z.object({
  toStatus: z.enum(["draft", "published", "deprecated", "archived"]),
});

/** The Component Library admin HTTP surface (Sprint 5.4). Pure delegation. */
export function componentsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/components",
      version: 1,
      permission: "components:create",
      idempotent: true,
      summary: "Create a component definition",
      schema: { body: createComponentDefinitionBody },
      handle: ({ body, context }) =>
        admin.components.create(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/components/:componentDefinitionId/transitions",
      version: 1,
      permission: "components:advance",
      idempotent: true,
      summary: "Advance a component definition's status",
      schema: { params: componentDefinitionIdParams, body: advanceComponentDefinitionBody },
      handle: ({ params, body, context }) =>
        admin.components.advance(context.principal, {
          componentDefinitionId: params.componentDefinitionId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/components",
      version: 1,
      permission: "components:read",
      summary: "List component definitions (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(
          await admin.components.list(context.principal, {
            ...query,
            tenantId: context.tenantId,
          }),
          toComponentDefinitionDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/components/:componentDefinitionId",
      version: 1,
      permission: "components:read",
      summary: "Get one component definition by id",
      schema: { params: componentDefinitionIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.components.get(context.principal, {
          ...params,
          tenantId: context.tenantId,
        });
        if (response.status !== 200) return response;
        return {
          status: 200,
          body: toComponentDefinitionDto(response.body as ComponentDefinition),
        };
      },
    }),
  ] as readonly RouteDefinition[];
}
