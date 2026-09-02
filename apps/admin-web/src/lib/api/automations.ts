import { getAdminApi } from "./client";

export interface WorkflowExecutionDto {
  readonly status: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

export interface WorkflowListItemDto {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly triggerType: string;
  readonly eventType: string | null;
  readonly cronExpression: string | null;
  readonly lastExecution: WorkflowExecutionDto | null;
}

export interface AutomationsPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface WorkflowsPageDto {
  readonly items: readonly WorkflowListItemDto[];
  readonly pageInfo: AutomationsPageInfo;
}

function isWorkflowsPageDto(value: unknown): value is WorkflowsPageDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

export type FetchWorkflowsPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly WorkflowListItemDto[];
      readonly pageInfo: AutomationsPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a cursor-paginated page of workflows for the Automations list screen. */
export async function fetchWorkflowsPage(query: {
  readonly first?: number;
  readonly after?: string;
}): Promise<FetchWorkflowsPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);

  const result = await getAdminApi(
    `/api/v1/automation/workflows?${params.toString()}`,
    isWorkflowsPageDto,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", items: result.data.items, pageInfo: result.data.pageInfo };
  }
  if (result.outcome === "unauthorized") {
    return { outcome: "unauthorized" };
  }
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}
