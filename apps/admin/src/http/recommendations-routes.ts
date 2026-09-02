import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { RecommendationModel } from "@platform/recommendations";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const pageQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});

export interface ScoredProductRefDto {
  readonly productRef: string;
  readonly score: number;
}

export interface RecommendationSetDto {
  readonly anchorRef: string;
  readonly scoredRefs: readonly ScoredProductRefDto[];
  readonly generatedAt: string;
}

export interface RecommendationModelDto {
  readonly id: string;
  readonly name: string;
  readonly strategy: string;
  readonly status: string;
  readonly sets: readonly RecommendationSetDto[];
}

function toRecommendationModelDto(model: RecommendationModel): RecommendationModelDto {
  return {
    id: model.id.toString(),
    name: model.name,
    strategy: model.strategy.value,
    status: model.status.value,
    sets: model.sets.map((s) => ({
      anchorRef: s.anchorRef,
      scoredRefs: s.scoredRefs.map((r) => ({ productRef: r.productRef, score: r.score })),
      generatedAt: s.generatedAt.toISOString(),
    })),
  };
}

const createModelBody = z.object({
  name: z.string().min(1),
  strategy: z.enum([
    "related",
    "frequently_bought_together",
    "recently_viewed",
    "personalized",
    "trending",
    "popular",
    "similar",
  ]),
});
const modelIdParams = z.object({ modelId: z.string().min(1) });
const advanceModelBody = z.object({
  toStatus: z.enum(["draft", "training", "active", "retired"]),
});
const generateSetBody = z.object({
  interactionId: z.string().min(1),
  anchorRef: z.string().min(1),
});
const regenerateSetBody = z.object({ anchorRef: z.string().min(1) });

/** The Recommendations admin HTTP surface (Sprint S1). Pure delegation. */
export function recommendationsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/recommendation-models",
      version: 1,
      permission: "recommendations:create",
      idempotent: true,
      summary: "Create a recommendation model",
      schema: { body: createModelBody },
      handle: ({ body, context }) => admin.recommendations.create(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/recommendation-models/:modelId/transitions",
      version: 1,
      permission: "recommendations:advance",
      idempotent: true,
      summary: "Advance a recommendation model's status (startTraining/activate/retire)",
      schema: { params: modelIdParams, body: advanceModelBody },
      handle: ({ params, body, context }) =>
        admin.recommendations.advance(context.principal, { modelId: params.modelId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/recommendation-models/:modelId/generate",
      version: 1,
      permission: "recommendations:generate",
      summary: "Generate a recommendation set from an interaction event (replay-safe)",
      schema: { params: modelIdParams, body: generateSetBody },
      handle: ({ params, body, context }) =>
        admin.recommendations.generate(context.principal, { modelId: params.modelId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/recommendation-models/:modelId/regenerate",
      version: 1,
      permission: "recommendations:regenerate",
      idempotent: true,
      summary: "Force-regenerate a recommendation set for an anchor",
      schema: { params: modelIdParams, body: regenerateSetBody },
      handle: ({ params, body, context }) =>
        admin.recommendations.regenerate(context.principal, { modelId: params.modelId, ...body }),
    }),
    defineRoute({
      method: "GET",
      path: "/recommendation-models",
      version: 1,
      permission: "recommendations:read",
      summary: "List recommendation models (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(await admin.recommendations.list(context.principal, query), toRecommendationModelDto),
    }),
    defineRoute({
      method: "GET",
      path: "/recommendation-models/:modelId",
      version: 1,
      permission: "recommendations:read",
      summary: "Get one recommendation model by id (including its generated sets)",
      schema: { params: modelIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.recommendations.get(context.principal, params);
        if (response.status !== 200) return response;
        return { status: 200, body: toRecommendationModelDto(response.body as RecommendationModel) };
      },
    }),
  ] as readonly RouteDefinition[];
}
