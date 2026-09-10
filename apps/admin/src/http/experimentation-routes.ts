import { z } from "zod";
import type { Experiment } from "@platform/experimentation";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const pageQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});

export interface VariantDto {
  readonly key: string;
  readonly allocationPercentage: number;
  readonly isControl: boolean;
}

export interface ExperimentResultDto {
  readonly variantKey: string;
  readonly metricValue: number;
  readonly sampleSize: number;
  readonly occurredAt: string;
}

export interface ExperimentDto {
  readonly id: string;
  readonly name: string;
  readonly hypothesis: string | null;
  readonly variants: readonly VariantDto[];
  readonly audiencePercentage: number;
  readonly audienceSegmentRefs: readonly string[] | null;
  readonly goalMetricRef: string;
  readonly featureFlagRef: string | null;
  readonly status: string;
  readonly results: readonly ExperimentResultDto[];
  readonly winnerVariantKey: string | null;
}

function toExperimentDto(experiment: Experiment): ExperimentDto {
  return {
    id: experiment.id.toString(),
    name: experiment.name,
    hypothesis: experiment.hypothesis ?? null,
    variants: experiment.variants.map((v) => ({
      key: v.key,
      allocationPercentage: v.allocationPercentage,
      isControl: v.isControl,
    })),
    audiencePercentage: experiment.audience.percentage,
    audienceSegmentRefs: experiment.audience.segmentRefs ?? null,
    goalMetricRef: experiment.goalMetricRef,
    featureFlagRef: experiment.featureFlagRef ?? null,
    status: experiment.status.value,
    results: experiment.results.map((r) => ({
      variantKey: r.variantKey,
      metricValue: r.metricValue,
      sampleSize: r.sampleSize,
      occurredAt: r.occurredAt.toISOString(),
    })),
    winnerVariantKey: experiment.winnerVariantKey ?? null,
  };
}

const createExperimentBody = z.object({
  name: z.string().min(1),
  hypothesis: z.string().min(1).optional(),
  variants: z
    .array(
      z.object({
        key: z.string().min(1),
        allocationPercentage: z.number(),
        isControl: z.boolean(),
      }),
    )
    .min(1),
  goalMetricRef: z.string().min(1),
  audiencePercentage: z.number().min(0).max(100).optional(),
  audienceSegmentRefs: z.array(z.string().min(1)).optional(),
  featureFlagRef: z.string().min(1).optional(),
});
const experimentIdParams = z.object({ experimentId: z.string().min(1) });
const advanceExperimentBody = z.object({
  toStatus: z.enum(["draft", "running", "paused", "completed", "archived"]),
});
const recordResultBody = z.object({
  variantKey: z.string().min(1),
  metricValue: z.number(),
  sampleSize: z.number().int().min(0),
});
const declareWinnerBody = z.object({ variantKey: z.string().min(1) });

/** The Experimentation admin HTTP surface (Sprint S1). Pure delegation. */
export function experimentationRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/experiments",
      version: 1,
      permission: "experiments:create",
      idempotent: true,
      summary: "Create an experiment (variant allocations must sum to 100)",
      schema: { body: createExperimentBody },
      handle: ({ body, context }) =>
        admin.experimentation.create(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/experiments/:experimentId/transitions",
      version: 1,
      permission: "experiments:advance",
      idempotent: true,
      summary: "Advance an experiment's status (start/pause/resume/complete/archive)",
      schema: { params: experimentIdParams, body: advanceExperimentBody },
      handle: ({ params, body, context }) =>
        admin.experimentation.advance(context.principal, {
          experimentId: params.experimentId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/experiments/:experimentId/results",
      version: 1,
      permission: "experiments:record_result",
      summary: "Record a metric observation for a variant",
      schema: { params: experimentIdParams, body: recordResultBody },
      handle: ({ params, body, context }) =>
        admin.experimentation.recordResult(context.principal, {
          experimentId: params.experimentId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/experiments/:experimentId/winner",
      version: 1,
      permission: "experiments:declare_winner",
      idempotent: true,
      summary: "Declare the winning variant",
      schema: { params: experimentIdParams, body: declareWinnerBody },
      handle: ({ params, body, context }) =>
        admin.experimentation.declareWinner(context.principal, {
          experimentId: params.experimentId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/experiments",
      version: 1,
      permission: "experiments:read",
      summary: "List experiments (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(
          await admin.experimentation.list(context.principal, {
            ...query,
            tenantId: context.tenantId,
          }),
          toExperimentDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/experiments/:experimentId",
      version: 1,
      permission: "experiments:read",
      summary: "Get one experiment by id",
      schema: { params: experimentIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.experimentation.get(context.principal, {
          ...params,
          tenantId: context.tenantId,
        });
        if (response.status !== 200) return response;
        return { status: 200, body: toExperimentDto(response.body as Experiment) };
      },
    }),
  ] as readonly RouteDefinition[];
}
