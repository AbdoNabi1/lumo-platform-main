import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { AutomationWorkflow } from "@platform/automation";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const createWorkflowBody = z.object({
  name: z.string().min(1),
  triggerType: z.enum(["event", "scheduled"]),
  eventType: z.string().min(1).optional(),
  cronExpression: z.string().min(1).optional(),
  actions: z
    .array(
      z.object({
        actionType: z.string().min(1),
        params: z.record(z.unknown()).optional(),
      }),
    )
    .min(1),
});
const workflowIdParams = z.object({ workflowId: z.string().min(1) });
const advanceWorkflowBody = z.object({
  toStatus: z.enum(["draft", "active", "paused", "archived"]),
});
const triggerWorkflowBody = z.object({ triggerId: z.string().min(1) });
const retryExecutionBody = z.object({ executionId: z.string().min(1) });
const listWorkflowsQuery = z.object({
  first: z.coerce.number().int().min(1).max(100).optional(),
  after: z.string().min(1).optional(),
});

/**
 * `AutomationWorkflow` (`@platform/automation`) is an `Entity` — same DTO discipline as
 * {@link toOrderListItemDto}. `lastExecution` is real, persisted data (the workflow's own
 * append-only `executions` list, `packages/db/prisma/schema/automation.prisma`'s
 * `executions Json`) — never fabricated.
 */
export interface WorkflowListItemDto {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly triggerType: string;
  readonly eventType: string | null;
  readonly cronExpression: string | null;
  readonly lastExecution: {
    readonly status: string;
    readonly startedAt: string;
    readonly completedAt: string | null;
  } | null;
}

function toWorkflowListItemDto(workflow: AutomationWorkflow): WorkflowListItemDto {
  const last = workflow.executions[workflow.executions.length - 1];
  return {
    id: workflow.id.toString(),
    name: workflow.name,
    status: workflow.status.value,
    triggerType: workflow.trigger.type,
    eventType: workflow.trigger.eventType ?? null,
    cronExpression: workflow.trigger.cronExpression ?? null,
    lastExecution:
      last === undefined
        ? null
        : {
            status: last.status,
            startedAt: last.startedAt.toISOString(),
            completedAt: last.completedAt?.toISOString() ?? null,
          },
  };
}

/** The Automation admin HTTP surface (Sprint S1). Pure delegation. */
export function automationRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/automation/workflows",
      version: 1,
      permission: "automation:create",
      idempotent: true,
      summary: "Create a workflow",
      schema: { body: createWorkflowBody },
      handle: ({ body, context }) => admin.automation.create(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/automation/workflows/:workflowId/transitions",
      version: 1,
      permission: "automation:advance",
      idempotent: true,
      summary: "Advance a workflow's status (activate/pause/archive)",
      schema: { params: workflowIdParams, body: advanceWorkflowBody },
      handle: ({ params, body, context }) =>
        admin.automation.advance(context.principal, { workflowId: params.workflowId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/automation/workflows/:workflowId/trigger",
      version: 1,
      permission: "automation:trigger",
      idempotent: true,
      summary: "Run a workflow for one trigger (replay-safe by triggerId)",
      schema: { params: workflowIdParams, body: triggerWorkflowBody },
      handle: ({ params, body, context }) =>
        admin.automation.trigger(context.principal, { workflowId: params.workflowId, ...body }),
    }),
    defineRoute({
      method: "GET",
      path: "/automation/workflows",
      version: 1,
      permission: "automation:read",
      summary: "List workflows, most recently created first (cursor-paginated)",
      schema: { querystring: listWorkflowsQuery },
      handle: async ({ query, context }) =>
        mapPage(await admin.automation.list(context.principal, query), toWorkflowListItemDto),
    }),
    defineRoute({
      method: "POST",
      path: "/automation/workflows/:workflowId/retry",
      version: 1,
      permission: "automation:retry_execution",
      idempotent: true,
      summary: "Retry a failed execution (dead-letters once attempts are exhausted)",
      schema: { params: workflowIdParams, body: retryExecutionBody },
      handle: ({ params, body, context }) =>
        admin.automation.retryExecution(context.principal, {
          workflowId: params.workflowId,
          ...body,
        }),
    }),
  ] as readonly RouteDefinition[];
}
