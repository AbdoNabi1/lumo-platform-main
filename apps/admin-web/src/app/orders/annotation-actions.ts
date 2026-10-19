"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import {
  addOrderComment,
  changeOrderTags,
  deleteOrderComment,
  editOrderComment,
  fetchOrderTagSuggestions,
  updateOrderNote,
} from "@/lib/api/orders";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { characterCount, MAX_COMMENT_LENGTH, MAX_NOTE_LENGTH } from "@/lib/orders/order-tags";

/**
 * Order operations Part 2 — the order page's Notes, Tags and comment actions. Every argument is
 * untrusted (a client component calls these directly): it is checked here, one idempotency key is
 * minted per call, and the API decides permissions and authorship (never this layer).
 */

const MAX_TAGS_PER_CALL = 250;

async function dictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** The Notes card's dialog. A blank note removes it. */
export async function saveOrderNoteAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const orderId = stringField(formData, "orderId");
  const note = stringField(formData, "note").trim();
  if (orderId.length === 0)
    return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
  if (characterCount(note) > MAX_NOTE_LENGTH) {
    return {
      status: "error",
      message: t.formErrors.invalid,
      fieldErrors: { note: t.orderNotes.tooLong },
    };
  }
  const result = await updateOrderNote(
    orderId,
    note.length === 0 ? null : note,
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    revalidatePath(`/orders/${orderId}`);
    return { status: "success" };
  }
  return toFormState(result, t.formErrors);
}

/** What the Tags card shows after a change. */
export type TagsActionState =
  | { readonly status: "saved"; readonly tags: readonly string[] }
  | { readonly status: "error"; readonly message: string };

/** The Tags card: Enter/comma adds, × removes — saved immediately (Shopify). */
export async function changeOrderTagsAction(
  orderId: string,
  change: { readonly add?: readonly string[]; readonly remove?: readonly string[] },
): Promise<TagsActionState> {
  const t = await dictionary();
  const add = stringList(change.add);
  const remove = stringList(change.remove);
  if (
    typeof orderId !== "string" ||
    orderId.length === 0 ||
    add.length + remove.length === 0 ||
    add.length > MAX_TAGS_PER_CALL ||
    remove.length > MAX_TAGS_PER_CALL
  ) {
    return { status: "error", message: t.formErrors.invalid };
  }
  const result = await changeOrderTags(
    orderId,
    { ...(add.length > 0 ? { add } : {}), ...(remove.length > 0 ? { remove } : {}) },
    newIdempotencyKey(),
  );
  if (result.outcome === "invalid") {
    // The API's only 422 here is the 250-tag cap (field "tags"); say it in the merchant's words.
    const capped = result.fields.some((issue) => issue.field === "tags");
    return { status: "error", message: capped ? t.orderTags.limit : t.formErrors.invalid };
  }
  if (result.outcome !== "ok") {
    const state = toFormState(result, t.formErrors);
    return {
      status: "error",
      message: state.status === "error" ? state.message : t.formErrors.unexpected,
    };
  }
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  return { status: "saved", tags: result.data.tags };
}

/** The tag input's suggestions; a failed read simply suggests nothing. */
export async function suggestOrderTagsAction(prefix: string): Promise<readonly string[]> {
  if (typeof prefix !== "string") return [];
  const trimmed = prefix.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return [];
  const found = await fetchOrderTagSuggestions(trimmed);
  return found === null ? [] : found.map((usage) => usage.tag);
}

type Dictionary = Awaited<ReturnType<typeof dictionary>>;

/** Why a comment form cannot be sent, or null when it can. */
function commentProblem(orderId: string, body: string, t: Dictionary): FormState | null {
  if (orderId.length === 0)
    return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
  if (body.length === 0) {
    return {
      status: "error",
      message: t.formErrors.invalid,
      fieldErrors: { body: t.orderComments.empty },
    };
  }
  if (characterCount(body) > MAX_COMMENT_LENGTH) {
    return {
      status: "error",
      message: t.formErrors.invalid,
      fieldErrors: { body: t.orderComments.tooLong },
    };
  }
  return null;
}

/** The timeline's composer ("Leave a comment..." → Post). */
export async function postOrderCommentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const orderId = stringField(formData, "orderId");
  const body = stringField(formData, "body").trim();
  const problem = commentProblem(orderId, body, t);
  if (problem !== null) return problem;
  const result = await addOrderComment(orderId, body, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath(`/orders/${orderId}`);
    return { status: "success" };
  }
  return toFormState(result, t.formErrors);
}

/** A comment's Edit → Save. */
export async function editOrderCommentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const orderId = stringField(formData, "orderId");
  const entryId = stringField(formData, "entryId");
  const body = stringField(formData, "body").trim();
  if (entryId.length === 0)
    return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
  const problem = commentProblem(orderId, body, t);
  if (problem !== null) return problem;
  const result = await editOrderComment(orderId, entryId, body, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath(`/orders/${orderId}`);
    return { status: "success" };
  }
  return toFormState(result, t.formErrors);
}

/** A comment's Delete (after the browser's confirmation). */
export async function deleteOrderCommentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const orderId = stringField(formData, "orderId");
  const entryId = stringField(formData, "entryId");
  if (orderId.length === 0 || entryId.length === 0) {
    return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
  }
  const result = await deleteOrderComment(orderId, entryId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath(`/orders/${orderId}`);
    return { status: "success" };
  }
  return toFormState(result, t.formErrors);
}
