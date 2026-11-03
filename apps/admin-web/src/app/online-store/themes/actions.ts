"use server";

import { revalidatePath } from "next/cache";
import type { ContrastWarning, ThemeDocument } from "@platform/storefront-content";
import type { FieldIssue } from "@/lib/api/client";
import { newIdempotencyKey } from "@/lib/api/mutation";
import {
  discardThemeDraft,
  issuePreviewToken,
  publishTheme,
  restoreThemeRelease,
  saveThemeDraft,
} from "@/lib/api/online-store";
import { codeOf } from "@/lib/online-store/codes";
import { revalidateStorefront } from "@/lib/storefront-revalidate";

export type DraftSaveResult =
  | {
      readonly status: "ok";
      readonly draftRevision: number;
      readonly version: number;
      readonly warnings: readonly ContrastWarning[];
    }
  /** `VERSION_CONFLICT`: someone else saved; the editor stops and asks for a reload. */
  | { readonly status: "conflict" }
  /** The same Idempotency-Key is still being handled (409 with no code): retryable, not a conflict. */
  | { readonly status: "in_flight" }
  | { readonly status: "invalid"; readonly fields: readonly FieldIssue[] }
  | { readonly status: "error" };

export type PublishActionResult =
  | { readonly status: "ok"; readonly releaseNumber: number; readonly liveDelayed?: true }
  | {
      readonly status: "draft_changed" | "nothing_to_publish" | "in_flight" | "forbidden" | "error";
    };

export type DraftRevisionResult =
  | { readonly status: "ok"; readonly draftRevision: number; readonly version: number }
  | { readonly status: "conflict" | "not_found" | "forbidden" | "error" };

const CLIENT_KEY = /^[A-Za-z0-9-]{16,100}$/;

/**
 * Ruling 2: the editor keeps one key while the request is unchanged, so a retry after a lost
 * response replays the first answer. Anything that is not a plain key gets a fresh one.
 */
const keyOf = (candidate: unknown): string =>
  typeof candidate === "string" && CLIENT_KEY.test(candidate) ? candidate : newIdempotencyKey();

/** A draft never touches the live storefront, so no revalidation here. */
export async function saveThemeDraftAction(input: {
  readonly document: ThemeDocument;
  readonly expectedVersion: number;
  readonly idempotencyKey?: string;
}): Promise<DraftSaveResult> {
  const result = await saveThemeDraft(
    input.document,
    input.expectedVersion,
    keyOf(input.idempotencyKey),
  );
  switch (result.outcome) {
    case "ok":
      return { status: "ok", ...result.data };
    case "conflict":
      return codeOf(result.message) === null ? { status: "in_flight" } : { status: "conflict" };
    case "invalid":
      return { status: "invalid", fields: result.fields };
    default:
      return { status: "error" };
  }
}

/**
 * Publishes exactly `expectedDraftRevision`, the revision the merchant previewed (Ruling 35).
 * `VERSION_CONFLICT` is a publish that lost a race with a save inside the transaction: the draft
 * changed, so it reads as `draft_changed`. A failed storefront nudge never fails the publish.
 */
export async function publishThemeAction(
  expectedDraftRevision: number,
  idempotencyKey?: string,
): Promise<PublishActionResult> {
  const result = await publishTheme(expectedDraftRevision, keyOf(idempotencyKey));
  if (result.outcome === "ok") {
    revalidatePath("/online-store/themes");
    const live = await revalidateStorefront();
    return live
      ? { status: "ok", releaseNumber: result.data.releaseNumber }
      : { status: "ok", releaseNumber: result.data.releaseNumber, liveDelayed: true };
  }
  if (result.outcome === "conflict") {
    const code = codeOf(result.message);
    if (code === null) return { status: "in_flight" };
    if (code === "DRAFT_CHANGED" || code === "VERSION_CONFLICT") return { status: "draft_changed" };
    if (code === "NOTHING_TO_PUBLISH") return { status: "nothing_to_publish" };
  }
  if (result.outcome === "forbidden" || result.outcome === "unauthorized")
    return { status: "forbidden" };
  return { status: "error" };
}

function revisionResult(
  result: Awaited<ReturnType<typeof discardThemeDraft>>,
): DraftRevisionResult {
  switch (result.outcome) {
    case "ok":
      return { status: "ok", ...result.data };
    case "conflict":
      return { status: "conflict" };
    case "not_found":
      return { status: "not_found" };
    case "forbidden":
    case "unauthorized":
      return { status: "forbidden" };
    default:
      return { status: "error" };
  }
}

export async function discardThemeDraftAction(
  expectedVersion: number,
): Promise<DraftRevisionResult> {
  const result = revisionResult(await discardThemeDraft(expectedVersion, newIdempotencyKey()));
  if (result.status === "ok") revalidatePath("/online-store/themes");
  return result;
}

/** Restore goes into the DRAFT (Decision 29); the live store changes only on Publish. */
export async function restoreReleaseAction(
  releaseNumber: number,
  expectedVersion: number,
): Promise<DraftRevisionResult> {
  const result = revisionResult(
    await restoreThemeRelease(releaseNumber, expectedVersion, newIdempotencyKey()),
  );
  if (result.status === "ok") revalidatePath("/online-store/themes");
  return result;
}

/**
 * Spec 1.6: the API's primary-host url, else STOREFRONT_URL + ?preview=<token>. The url carries the
 * token, so it goes only to the caller (the preview frame or tab) and is never logged.
 * `expiresInMs` is the lifetime left by this server's clock, so the browser's clock (which may be
 * off) never decides when the token expires (M-4).
 */
export async function previewUrlAction(): Promise<
  | {
      readonly status: "ok";
      readonly url: string;
      readonly expiresAt: string;
      readonly expiresInMs?: number;
    }
  | { readonly status: "error" }
> {
  const result = await issuePreviewToken();
  if (result.outcome !== "ok") return { status: "error" };
  const { expiresAt } = result.data;
  const left = Date.parse(expiresAt) - Date.now();
  const lifetime = Number.isFinite(left) ? { expiresInMs: left } : {};
  if (result.data.url !== null)
    return { status: "ok", url: result.data.url, expiresAt, ...lifetime };
  const base = process.env["STOREFRONT_URL"]?.trim().replace(/\/+$/, "") ?? "";
  if (base === "") return { status: "error" };
  return {
    status: "ok",
    url: `${base}/?preview=${encodeURIComponent(result.data.token)}`,
    expiresAt,
    ...lifetime,
  };
}
