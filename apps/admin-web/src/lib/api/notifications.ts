import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

/**
 * T5.11a — Notifications (`apps/admin/src/http/notifications-routes.ts`). No frontend existed for
 * this domain before this task. List/get are fully DTO-mapped on the backend (`toNotificationDto`),
 * so the read side here follows `lib/api/reviews.ts`'s `fetchReviewsPage`/`fetchReview` pattern
 * exactly. The 6 write routes don't map their responses through `toNotificationDto`
 * (`NotificationsAdminController`'s handlers return whatever the domain layer returns directly,
 * unmapped) — same discipline `lib/api/reviews.ts`'s doc comment describes for its own write
 * routes: read only an `id` off the create response, nothing off the rest, and let the caller
 * `revalidatePath` to pick up the real, DTO-mapped state.
 */

export interface NotificationDeliveryAttemptDto {
  readonly channel: string;
  readonly outcome: string;
  readonly providerRef: string | null;
  readonly occurredAt: string;
}

export interface NotificationEventDto {
  readonly status: string;
  readonly occurredAt: string;
}

export interface NotificationDto {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly sourceRef: string;
  readonly recipientRef: string;
  readonly channels: readonly string[];
  readonly currentChannel: string;
  readonly templateId: string;
  readonly status: string;
  readonly attempts: readonly NotificationDeliveryAttemptDto[];
  readonly history: readonly NotificationEventDto[];
  readonly deliveredAt: string | null;
}

export interface NotificationsPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface NotificationsPageDto {
  readonly items: readonly NotificationDto[];
  readonly pageInfo: NotificationsPageInfo;
}

function isNotificationsPageDto(value: unknown): value is NotificationsPageDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

function isNotificationDto(value: unknown): value is NotificationDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

export type FetchNotificationsPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly NotificationDto[];
      readonly pageInfo: NotificationsPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a cursor-paginated page of notifications (`GET /notifications`, `notifications:read`). */
export async function fetchNotificationsPage(query: {
  readonly first?: number;
  readonly after?: string;
}): Promise<FetchNotificationsPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);

  const result = await getAdminApi(
    `/api/v1/notifications?${params.toString()}`,
    isNotificationsPageDto,
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

export type FetchNotificationResult =
  | { readonly outcome: "ok"; readonly notification: NotificationDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a single notification (`GET /notifications/:notificationId`, `notifications:read`). */
export async function fetchNotification(notificationId: string): Promise<FetchNotificationResult> {
  const result = await getAdminApi(
    `/api/v1/notifications/${encodeURIComponent(notificationId)}`,
    isNotificationDto,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", notification: result.data };
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

function notificationPath(notificationId: string, suffix = ""): string {
  return `/api/v1/notifications/${encodeURIComponent(notificationId)}${suffix}`;
}

export interface CreateNotificationInput {
  readonly sourceRef: string;
  readonly recipientRef: string;
  readonly channels: readonly string[];
  readonly templateId: string;
  readonly bodyPattern: string;
  readonly subjectPattern?: string;
  readonly variables: Readonly<Record<string, string>>;
  readonly maxAttempts: number;
  readonly expiresAt?: string;
}

/**
 * `POST /notifications` (`idempotent: true`, `notifications:create`). This body carries its own
 * `idempotencyKey` field, separate from the `Idempotency-Key` HTTP header — the caller mints one
 * `newIdempotencyKey()` value and passes it for both `idempotencyKey` (the input) and the header
 * arg here, same double-field pattern `lib/api/reviews.ts`'s `moderateReview` uses for `actionId`.
 */
export async function createNotification(
  input: CreateNotificationInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/notifications",
    { method: "POST", body: { ...input, idempotencyKey }, idempotencyKey },
    isCreatedRecord,
  );
  if (result.outcome !== "ok") return result;
  const id = typeof result.data.id === "string" ? result.data.id : "";
  return { outcome: "ok", data: { id } };
}

/**
 * `POST /notifications/:notificationId/queue` (`idempotent: true`, `notifications:queue`) —
 * `created` -> `queued`, no body.
 */
export function queueNotification(
  notificationId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    notificationPath(notificationId, "/queue"),
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}

/**
 * `POST /notifications/:notificationId/send` (**not** idempotent — no `Idempotency-Key` sent, per
 * the route table — `notifications:send`) — `queued`/`retrying` -> `sent`, no body.
 */
export function sendNotification(notificationId: string): Promise<MutationResult<unknown>> {
  return mutateAdminApi(notificationPath(notificationId, "/send"), { method: "POST" }, isUnknown);
}

/**
 * `POST /notifications/:notificationId/retry` (`idempotent: true`, `notifications:retry`) —
 * `failed` -> `retrying`, no body.
 */
export function retryNotification(
  notificationId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    notificationPath(notificationId, "/retry"),
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}

/**
 * `POST /notifications/:notificationId/transitions` (`idempotent: true`, `notifications:advance`)
 * — the generic fallback for the transition targets `queue`/`send`/`retry` don't dedicate an
 * action to (`lib/notification-lifecycle.ts`'s `advanceableNotificationStatusesFrom`).
 */
export function advanceNotification(
  notificationId: string,
  toStatus: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    notificationPath(notificationId, "/transitions"),
    { method: "POST", body: { toStatus }, idempotencyKey },
    isUnknown,
  );
}

export interface RecordNotificationCallbackInput {
  readonly provider: string;
  readonly callbackId: string;
  readonly kind: string;
}

/**
 * `POST /notifications/:notificationId/callback` (**not** idempotent — no `Idempotency-Key` sent,
 * per the route table — `notifications:callback`) — records a provider callback (replay-safe on
 * the backend by `callbackId`). Normally provider-initiated (a delivery webhook), offered here
 * mostly for completeness/testing, same precedent as `lib/api/reviews.ts`'s `reportReview`/
 * `voteReview`.
 */
export function recordNotificationCallback(
  notificationId: string,
  input: RecordNotificationCallbackInput,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    notificationPath(notificationId, "/callback"),
    { method: "POST", body: input },
    isUnknown,
  );
}
