import { z } from "zod";
import type { Experience } from "@platform/experience";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const pageQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});

export interface ExperienceDto {
  readonly id: string;
  readonly name: string;
  readonly experienceType: string;
  readonly status: string;
  readonly sections: Experience["canvas"]["sections"];
}

function toExperienceDto(experience: Experience): ExperienceDto {
  return {
    id: experience.id.toString(),
    name: experience.name,
    experienceType: experience.experienceType,
    status: experience.status.value,
    sections: experience.canvas.sections,
  };
}

const createExperienceBody = z.object({
  name: z.string().min(1),
  experienceType: z.string().min(1),
});
const experienceIdParams = z.object({ experienceId: z.string().min(1) });
const advanceExperienceBody = z.object({ toStatus: z.enum(["draft", "published", "archived"]) });
const componentInstanceSchema = z.object({
  componentRef: z.string().min(1),
  props: z.record(z.unknown()),
});
const slotSchema = z.object({
  key: z.string().min(1),
  componentInstances: z.array(componentInstanceSchema),
});
const sectionSchema = z.object({ key: z.string().min(1), slots: z.array(slotSchema) });
const updateCanvasBody = z.object({ sections: z.array(sectionSchema) });

/** The Experience Builder admin HTTP surface (Sprint 5.4). Pure delegation. */
export function experienceRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/experiences",
      version: 1,
      permission: "experience:create",
      idempotent: true,
      summary: "Create an experience layout",
      schema: { body: createExperienceBody },
      handle: ({ body, context }) =>
        admin.experience.create(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/experiences/:experienceId/transitions",
      version: 1,
      permission: "experience:advance",
      idempotent: true,
      summary: "Advance an experience's status",
      schema: { params: experienceIdParams, body: advanceExperienceBody },
      handle: ({ params, body, context }) =>
        admin.experience.advance(context.principal, {
          experienceId: params.experienceId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "PUT",
      path: "/experiences/:experienceId/canvas",
      version: 1,
      permission: "experience:update_canvas",
      idempotent: true,
      summary: "Replace an experience's draft canvas tree",
      schema: { params: experienceIdParams, body: updateCanvasBody },
      handle: ({ params, body, context }) =>
        admin.experience.updateCanvas(context.principal, {
          experienceId: params.experienceId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/experiences",
      version: 1,
      permission: "experience:read",
      summary: "List experiences (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(
          await admin.experience.list(context.principal, {
            ...query,
            tenantId: context.tenantId,
          }),
          toExperienceDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/experiences/:experienceId",
      version: 1,
      permission: "experience:read",
      summary: "Get one experience by id",
      schema: { params: experienceIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.experience.get(context.principal, {
          ...params,
          tenantId: context.tenantId,
        });
        if (response.status !== 200) return response;
        return { status: 200, body: toExperienceDto(response.body as Experience) };
      },
    }),
  ] as readonly RouteDefinition[];
}
