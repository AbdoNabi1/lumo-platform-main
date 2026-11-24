"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createCustomerSegment,
  deleteCustomerSegment,
  previewCustomerSegment,
  updateCustomerSegment,
  type SegmentCondition,
  type SegmentMembersPage,
} from "@/lib/api/customer-segments";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import type { MutationResult } from "@/lib/api/client";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/**
 * Shopify parity Wave 1c — the Customers > Segments write actions. Same discipline as
 * `app/customers/actions.ts`: one `Idempotency-Key` per invocation, `revalidatePath` after EVERY
 * outcome that reached the API (a stale 409 or a 403 may still mean the screen is out of date),
 * and the API's own answer mapped onto the form. Every semantic limit (name 1..100, 1..10
 * conditions, value ranges) belongs to the API, which answers 422 with the failing paths
 * (`name`, `conditions`, `conditions.<i>.<value|valueMinor|days|date|values|op|field>`); those
 * keep their server path so the editor can show each on its own row.
 */

export type SegmentFormState = FormState;

export type SegmentPreviewState =
  | { readonly status: "ok"; readonly page: SegmentMembersPage }
  /** 503 `UNAVAILABLE`: the store has no database for live segments. */
  | { readonly status: "unavailable" }
  | {
      readonly status: "error";
      readonly message: string;
      readonly fieldErrors: Readonly<Record<string, string>>;
    };

const LIST_PATH = "/customers/segments";
const PREVIEW_SIZE = 10;

/** Identity's exact 409 messages (`customer-segment.use-cases.ts`); none carries a code of its own. */
const DUPLICATE_NAME = "A segment with this name already exists";
const STALE = "This segment was changed by someone else";
const READ_ONLY = "Default segments can't be changed";
/** The 100-segment cap: a business rule (409 `BUSINESS_RULE`) that retrying cannot clear. */
const LIMIT = "A store can have at most 100 segments";
const BUSINESS_RULE = "BUSINESS_RULE";

async function dictionary(): Promise<Dictionary> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

function invalid(t: Dictionary): SegmentFormState {
  return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
}

function detailPath(segmentId: string): string {
  return `${LIST_PATH}/${encodeURIComponent(segmentId)}`;
}

function formStateOf(result: MutationResult<unknown>, t: Dictionary): SegmentFormState {
  if (result.outcome === "conflict") {
    if (result.message === DUPLICATE_NAME) {
      const message = t.segments.errors.duplicateName;
      return { status: "error", message, fieldErrors: { name: message } };
    }
    if (result.message === STALE) {
      return { status: "error", message: t.segments.errors.stale, fieldErrors: {} };
    }
    if (result.message === READ_ONLY) {
      return { status: "error", message: t.segments.errors.readOnly, fieldErrors: {} };
    }
    if (result.message === LIMIT && result.code === BUSINESS_RULE) {
      return { status: "error", message: t.segments.errors.limit, fieldErrors: {} };
    }
    // Any other 409 (an in-flight Idempotency-Key, an unrecognised rule): the locale's "try again".
    return { status: "error", message: t.formErrors.conflict, fieldErrors: {} };
  }
  return toFormState(result, t.formErrors);
}

/** Creates a custom segment; on success goes to the new segment's page. */
export async function createSegmentAction(input: {
  readonly name: string;
  readonly conditions: readonly SegmentCondition[];
}): Promise<SegmentFormState> {
  const t = await dictionary();

  const result = await createCustomerSegment(
    { name: input.name, conditions: input.conditions },
    newIdempotencyKey(),
  );
  revalidatePath(LIST_PATH);
  if (result.outcome === "ok") {
    revalidatePath(detailPath(result.data.segmentId));
    redirect(detailPath(result.data.segmentId));
  }
  return formStateOf(result, t);
}

/** Renames a segment and/or replaces its conditions; `expectedVersion` is the version the editor loaded. */
export async function updateSegmentAction(
  segmentId: string,
  input: {
    readonly expectedVersion: number;
    readonly name: string;
    readonly conditions: readonly SegmentCondition[];
  },
): Promise<SegmentFormState> {
  const t = await dictionary();
  if (segmentId === "" || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    return invalid(t);
  }

  const result = await updateCustomerSegment(
    segmentId,
    { expectedVersion: input.expectedVersion, name: input.name, conditions: input.conditions },
    newIdempotencyKey(),
  );
  revalidatePath(LIST_PATH);
  revalidatePath(detailPath(segmentId));
  return formStateOf(result, t);
}

/** Deletes a custom segment; on success returns to the list. */
export async function deleteSegmentAction(
  segmentId: string,
  expectedVersion: number,
): Promise<SegmentFormState> {
  const t = await dictionary();
  if (segmentId === "" || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return invalid(t);
  }

  const result = await deleteCustomerSegment(segmentId, expectedVersion, newIdempotencyKey());
  revalidatePath(LIST_PATH);
  revalidatePath(detailPath(segmentId));
  if (result.outcome === "ok") redirect(LIST_PATH);
  return formStateOf(result, t);
}

/** The editor's live preview: a read — no idempotency key, nothing revalidated. */
export async function previewSegmentAction(
  conditions: readonly SegmentCondition[],
): Promise<SegmentPreviewState> {
  const t = await dictionary();

  const result = await previewCustomerSegment(conditions, PREVIEW_SIZE);
  if (result.outcome === "ok") return { status: "ok", page: result.data };
  if (result.outcome === "error" && result.status === 503 && result.code === "UNAVAILABLE") {
    return { status: "unavailable" };
  }
  const state = toFormState(result, t.formErrors);
  return state.status === "error"
    ? { status: "error", message: state.message, fieldErrors: state.fieldErrors }
    : { status: "error", message: t.formErrors.unexpected, fieldErrors: {} };
}
