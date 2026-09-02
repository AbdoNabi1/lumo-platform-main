import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

/**
 * T5.11b — Experimentation (`apps/admin/src/http/experimentation-routes.ts`). No frontend existed
 * for this domain before this task. List/get are fully DTO-mapped on the backend
 * (`toExperimentDto`), so the read side here follows `lib/api/feature-flags.ts`'s
 * `fetchFeatureFlagsPage`/`fetchFeatureFlag` pattern exactly. The 4 write routes don't map their
 * responses through `toExperimentDto` — same discipline described there: read only an `id` off the
 * create response, nothing off the rest, and let the caller `revalidatePath` to pick up the real,
 * DTO-mapped state.
 */

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

export interface ExperimentsPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface ExperimentsPageDto {
  readonly items: readonly ExperimentDto[];
  readonly pageInfo: ExperimentsPageInfo;
}

function isExperimentsPageDto(value: unknown): value is ExperimentsPageDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

function isExperimentDto(value: unknown): value is ExperimentDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

export type FetchExperimentsPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly ExperimentDto[];
      readonly pageInfo: ExperimentsPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a cursor-paginated page of experiments (`GET /experiments`, `experiments:read`). */
export async function fetchExperimentsPage(query: {
  readonly first?: number;
  readonly after?: string;
}): Promise<FetchExperimentsPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);

  const result = await getAdminApi(
    `/api/v1/experiments?${params.toString()}`,
    isExperimentsPageDto,
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

export type FetchExperimentResult =
  | { readonly outcome: "ok"; readonly experiment: ExperimentDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a single experiment (`GET /experiments/:experimentId`, `experiments:read`). */
export async function fetchExperiment(experimentId: string): Promise<FetchExperimentResult> {
  const result = await getAdminApi(
    `/api/v1/experiments/${encodeURIComponent(experimentId)}`,
    isExperimentDto,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", experiment: result.data };
  }
  if (result.outcome === "error") {
    return { outcome: "error", message: result.message };
  }
  return result;
}

function isUnknown(_value: unknown): _value is unknown {
  return true;
}

function isCreatedRecord(value: unknown): value is { readonly id?: unknown } {
  return typeof value === "object" && value !== null;
}

function experimentPath(experimentId: string, suffix = ""): string {
  return `/api/v1/experiments/${encodeURIComponent(experimentId)}${suffix}`;
}

export interface CreateExperimentVariantInput {
  readonly key: string;
  readonly allocationPercentage: number;
  readonly isControl: boolean;
}

export interface CreateExperimentInput {
  readonly name: string;
  readonly hypothesis?: string;
  readonly variants: readonly CreateExperimentVariantInput[];
  readonly goalMetricRef: string;
  readonly audiencePercentage?: number;
  readonly audienceSegmentRefs?: readonly string[];
  readonly featureFlagRef?: string;
}

/**
 * `POST /experiments` (`idempotent: true`, `experiments:create`). Variant allocations must sum to
 * 100 — `ExperimentCreateForm` checks this client-side before submit for a fast error, but the
 * backend is authoritative; a rejection still surfaces normally through `toFormState`.
 */
export async function createExperiment(
  input: CreateExperimentInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/experiments",
    { method: "POST", body: input, idempotencyKey },
    isCreatedRecord,
  );
  if (result.outcome !== "ok") return result;
  const id = typeof result.data.id === "string" ? result.data.id : "";
  return { outcome: "ok", data: { id } };
}

export type ExperimentStatus = "draft" | "running" | "paused" | "completed" | "archived";

/**
 * `POST /experiments/:experimentId/transitions` (`idempotent: true`, `experiments:advance`) — the
 * only status-changing route (see `lib/experiment-lifecycle.ts`). Unlike Feature Flags' transitions
 * route, this body carries no `changedBy` — just `toStatus`, per the route table.
 */
export function advanceExperiment(
  experimentId: string,
  toStatus: ExperimentStatus,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    experimentPath(experimentId, "/transitions"),
    { method: "POST", body: { toStatus }, idempotencyKey },
    isUnknown,
  );
}

export interface RecordExperimentResultInput {
  readonly variantKey: string;
  readonly metricValue: number;
  readonly sampleSize: number;
}

/**
 * `POST /experiments/:experimentId/results` (**not** idempotent — no `Idempotency-Key` sent, per
 * the route table — `experiments:record_result`).
 */
export function recordExperimentResult(
  experimentId: string,
  input: RecordExperimentResultInput,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    experimentPath(experimentId, "/results"),
    { method: "POST", body: input },
    isUnknown,
  );
}

/**
 * `POST /experiments/:experimentId/winner` (`idempotent: true`, `experiments:declare_winner`) —
 * `variantKey` is offered only among the experiment's own variant keys (`ExperimentLifecycleActions`).
 */
export function declareExperimentWinner(
  experimentId: string,
  variantKey: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    experimentPath(experimentId, "/winner"),
    { method: "POST", body: { variantKey }, idempotencyKey },
    isUnknown,
  );
}
