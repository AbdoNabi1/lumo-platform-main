"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  advanceReview,
  createReview,
  moderateReview,
  reportReview,
  respondToReview,
  voteReview,
  type ModerateReviewAction,
  type ReviewStatus,
} from "@/lib/api/reviews";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.10 — the Review moderation queue's write actions (`app/reviews/new/page.tsx`, `app/reviews/
 * [reviewId]/page.tsx`). Same shape every write action in this app follows (`app/orders/actions.ts`
 * 's own T5.2 doc comment, `apps/admin-web/README.md`'s recipe): parse `FormData` defensively
 * (never trust a hidden field or a closure variable — re-derive `reviewId` from the submission
 * itself), mint exactly one idempotency key per submit, call the typed `lib/api/reviews.ts`
 * function, and project any non-`ok` outcome through `toFormState`.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Empty string -> `undefined` (an omitted optional zod field), not a validation failure. */
function optionalStringField(formData: FormData, name: string): string | undefined {
  const value = stringField(formData, name).trim();
  return value.length === 0 ? undefined : value;
}

function isReviewStatus(value: string): value is ReviewStatus {
  return (
    value === "pending" ||
    value === "published" ||
    value === "rejected" ||
    value === "flagged" ||
    value === "removed"
  );
}

function isModerateAction(value: string): value is ModerateReviewAction {
  return value === "reject" || value === "flag" || value === "restore" || value === "remove";
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

/** Both screens that show one review's data — the queue's row link target and this screen's own path revalidate the same way, since the queue itself lists rows by status. */
function revalidateReviewScreens(reviewId: string): void {
  revalidatePath("/reviews");
  revalidatePath(`/reviews/${reviewId}`);
}

/** Creates a review (`ReviewCreateForm`, `app/reviews/new/page.tsx`) — normally customer-initiated, this admin console can also create one directly. */
export async function createReviewAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const productRef = stringField(formData, "productRef");
  const customerRef = stringField(formData, "customerRef");
  const ratingRaw = stringField(formData, "rating");
  const bodyText = stringField(formData, "bodyText");
  const assetRefsRaw = stringField(formData, "assetRefs");

  const rating = Number.parseInt(ratingRaw, 10);
  const fieldErrors: Record<string, string> = {};
  if (productRef.length === 0) fieldErrors["productRef"] = t.invalid;
  if (customerRef.length === 0) fieldErrors["customerRef"] = t.invalid;
  if (Number.isNaN(rating)) fieldErrors["rating"] = t.invalid;
  if (bodyText.length === 0) fieldErrors["bodyText"] = t.invalid;
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const assetRefs = assetRefsRaw
    .split(",")
    .map((ref) => ref.trim())
    .filter((ref) => ref.length > 0);

  const result = await createReview(
    {
      productRef,
      customerRef,
      rating,
      bodyText,
      assetRefs: assetRefs.length > 0 ? assetRefs : undefined,
    },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/reviews");
    redirect(`/reviews/${result.data.id}`);
  }
  return toFormState(result, t);
}

/**
 * Applies a moderator action (`ReviewModerationForm`, only offered for the actions
 * `lib/review-lifecycle.ts` allows at the review's current status). `actionId` is a client-minted
 * replay-safety key distinct from the `Idempotency-Key` header — this reuses the same
 * `newIdempotencyKey()` value for both, per the task brief's double-field note.
 */
export async function moderateReviewAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const reviewId = stringField(formData, "reviewId");
  const actionRaw = stringField(formData, "action");
  const moderatorRef = stringField(formData, "moderatorRef");
  const reason = optionalStringField(formData, "reason");

  if (reviewId.length === 0 || !isModerateAction(actionRaw) || moderatorRef.length === 0) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: moderatorRef.length === 0 ? { moderatorRef: t.invalid } : {},
    };
  }

  const key = newIdempotencyKey();
  const result = await moderateReview(
    reviewId,
    { actionId: key, action: actionRaw, moderatorRef, reason },
    key,
  );
  if (result.outcome === "ok") {
    revalidateReviewScreens(reviewId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Advances the review via the generic transitions route (`ReviewAdvanceForm`) — the fallback
 * offered only for `pending`'s `published` target, the one transition `moderate`'s 4 actions don't
 * cover (`lib/review-lifecycle.ts`'s `advanceableReviewStatusesFrom`).
 */
export async function advanceReviewAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const reviewId = stringField(formData, "reviewId");
  const toStatusRaw = stringField(formData, "toStatus");
  if (reviewId.length === 0 || !isReviewStatus(toStatusRaw)) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  const result = await advanceReview(reviewId, toStatusRaw, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateReviewScreens(reviewId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Records (or replaces) a helpful/unhelpful vote (`ReviewVoteForm`) — normally a customer action; offered here mostly for completeness/testing, per the task brief. */
export async function voteReviewAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const reviewId = stringField(formData, "reviewId");
  const customerRef = stringField(formData, "customerRef");
  const helpfulRaw = stringField(formData, "helpful");
  if (
    reviewId.length === 0 ||
    customerRef.length === 0 ||
    (helpfulRaw !== "true" && helpfulRaw !== "false")
  ) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: customerRef.length === 0 ? { customerRef: t.invalid } : {},
    };
  }

  const result = await voteReview(
    reviewId,
    { customerRef, helpful: helpfulRaw === "true" },
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    revalidateReviewScreens(reviewId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Records an abuse report (`ReviewReportForm`) — **not** idempotent, per the route table, so no `Idempotency-Key` is minted. Normally a customer action; offered here mostly for completeness/testing. */
export async function reportReviewAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const reviewId = stringField(formData, "reviewId");
  const reporterRef = stringField(formData, "reporterRef");
  if (reviewId.length === 0 || reporterRef.length === 0) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: reporterRef.length === 0 ? { reporterRef: t.invalid } : {},
    };
  }

  const result = await reportReview(reviewId, { reporterRef });
  if (result.outcome === "ok") {
    revalidateReviewScreens(reviewId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Sets or replaces the merchant response (`ReviewRespondForm`). */
export async function respondToReviewAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const reviewId = stringField(formData, "reviewId");
  const responseText = stringField(formData, "responseText");
  if (reviewId.length === 0 || responseText.length === 0) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: responseText.length === 0 ? { responseText: t.invalid } : {},
    };
  }

  const result = await respondToReview(reviewId, responseText, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateReviewScreens(reviewId);
    return { status: "success" };
  }
  return toFormState(result, t);
}
