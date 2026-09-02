import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

export interface ContentBlockListItemDto {
  readonly id: string;
  readonly name: string;
  readonly blockType: string;
  readonly status: string;
  readonly locale: string | null;
}

export interface ContentPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface ContentBlocksPageDto {
  readonly items: readonly ContentBlockListItemDto[];
  readonly pageInfo: ContentPageInfo;
}

function isContentBlocksPageDto(value: unknown): value is ContentBlocksPageDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

export type FetchContentBlocksPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly ContentBlockListItemDto[];
      readonly pageInfo: ContentPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a cursor-paginated page of content blocks for the Content list screen. */
export async function fetchContentBlocksPage(query: {
  readonly first?: number;
  readonly after?: string;
}): Promise<FetchContentBlocksPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);

  const result = await getAdminApi(
    `/api/v1/content-blocks?${params.toString()}`,
    isContentBlocksPageDto,
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

/**
 * T5.9a — the 3 content write routes (`apps/admin/src/http/content-routes.ts`). None of their
 * handlers map the response through a DTO (`admin.content.create`/`.advance`/`.updateBody` all
 * return the `ContentBlock` aggregate or its own result directly) — same discipline
 * `lib/api/products.ts`'s doc comment on its write routes describes: read only an `id` off a
 * create response, otherwise read nothing at all off the response body and let the caller
 * `revalidatePath` the list to pick up the real, DTO-mapped state.
 */

function isUnknown(_value: unknown): _value is unknown {
  return true;
}

function isCreatedContentBlock(value: unknown): value is { readonly id?: unknown } {
  return typeof value === "object" && value !== null;
}

export interface CreateContentBlockInput {
  readonly name: string;
  readonly blockType: string;
  readonly format: "html" | "markdown" | "json";
  readonly content: string;
  readonly locale?: string;
}

/** `POST /content-blocks` (`idempotent: true`, `content:create`). */
export async function createContentBlock(
  input: CreateContentBlockInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/content-blocks",
    { method: "POST", body: input, idempotencyKey },
    isCreatedContentBlock,
  );
  if (result.outcome !== "ok") return result;
  const id = typeof result.data.id === "string" ? result.data.id : "";
  return { outcome: "ok", data: { id } };
}

export interface AdvanceContentBlockInput {
  readonly toStatus: "draft" | "scheduled" | "published" | "archived";
  readonly scheduledAt?: string;
}

/** `POST /content-blocks/:contentBlockId/transitions` (`idempotent: true`, `content:advance`). */
export function advanceContentBlock(
  contentBlockId: string,
  input: AdvanceContentBlockInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/content-blocks/${encodeURIComponent(contentBlockId)}/transitions`,
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

export interface UpdateContentBlockBodyInput {
  readonly format: "html" | "markdown" | "json";
  readonly content: string;
}

/** `POST /content-blocks/:contentBlockId/body` (`idempotent: true`, `content:update`). */
export function updateContentBlockBody(
  contentBlockId: string,
  input: UpdateContentBlockBodyInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/content-blocks/${encodeURIComponent(contentBlockId)}/body`,
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}
