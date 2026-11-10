"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { LocalizedText } from "@platform/storefront-content";
import { advancePage, createPage, updatePageContent } from "@/lib/api/pages";
import { newIdempotencyKey, type FormState, type LiveSaveState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { saveErrorState } from "@/lib/online-store/save-errors";
import { revalidateStorefront } from "@/lib/storefront-revalidate";
import type { Dictionary } from "@/messages/en";

/**
 * The Pages write actions (T5.9a Part B, Part 2 spec 2.4). Each mints one `Idempotency-Key` per
 * invocation and maps every failure to the admin's own copy through `saveErrorState` (the API's
 * messages are English and carry codes). Content and visibility changes reach the live storefront,
 * so they also call `revalidateStorefront()`.
 */

/** A content save's outcome; on success, the version the next save must send. */
export type PageContentSaveState = LiveSaveState & { readonly version?: number };

type PageStatus = "draft" | "published" | "archived";

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** `<name>.ar` / `<name>.en` from the form, an empty one left out (absent means "not written"). */
function localizedField(formData: FormData, name: string): LocalizedText {
  const ar = stringField(formData, `${name}.ar`);
  const en = stringField(formData, `${name}.en`);
  return { ...(ar.trim() === "" ? {} : { ar }), ...(en.trim() === "" ? {} : { en }) };
}

function isPageStatus(value: unknown): value is PageStatus {
  return value === "draft" || value === "published" || value === "archived";
}

const isVersion = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

async function dictionary(): Promise<Dictionary> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

/** `{ ar?, en? }` with string values only, or null for anything else (an untrusted caller). */
function localizedOf(raw: unknown): LocalizedText | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { ar, en, ...rest } = raw as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (ar !== undefined && typeof ar !== "string") return null;
  if (en !== undefined && typeof en !== "string") return null;
  return { ...(ar === undefined ? {} : { ar }), ...(en === undefined ? {} : { en }) };
}

/**
 * "Add page" in one call (Ruling 17): the title (its first written language is also the page's
 * internal name), the content and the page address. A taken address is shown on the address
 * field (F14); an address the API refuses gets our address copy, never the server's English.
 */
export async function createPageAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const title = localizedField(formData, "title");
  const body = localizedField(formData, "body");
  const routePath = stringField(formData, "routePath").trim();
  const name = [title.ar, title.en].find((text) => text !== undefined)?.trim() ?? "";

  if (name.length === 0 || routePath.length === 0) {
    const fieldErrors: Record<string, string> = {};
    if (name.length === 0) fieldErrors["title"] = t.pageEditor.titleRequired;
    if (routePath.length === 0) fieldErrors["routePath"] = t.pageEditor.addressInvalid;
    return { status: "error", message: t.formErrors.invalid, fieldErrors };
  }

  const result = await createPage(
    {
      name,
      routePath,
      ...(Object.keys(title).length > 0 ? { title } : {}),
      ...(Object.keys(body).length > 0 ? { body } : {}),
    },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/pages");
    const id = result.data.id;
    redirect(id.length > 0 ? `/pages/${encodeURIComponent(id)}` : "/pages");
  }

  const state = saveErrorState(result, t);
  if (state.status !== "error") return state;
  const routeError = state.fieldErrors["routePath"];
  return routeError === t.formErrors.invalid
    ? { ...state, fieldErrors: { ...state.fieldErrors, routePath: t.pageEditor.addressInvalid } }
    : state;
}

/** After a page change: refresh the page screens, then the storefront (best effort). */
async function revalidated(pageId: string): Promise<boolean> {
  revalidatePath("/pages");
  revalidatePath(`/pages/${encodeURIComponent(pageId)}`);
  return revalidateStorefront();
}

/**
 * `PUT /pages/:pageId/content` with the version the editor loaded (one key per save). Works on a
 * draft and on a published page; `PAGE_ARCHIVED` and `VERSION_CONFLICT` get their own copy.
 */
export async function savePageContentAction(
  pageId: string,
  input: {
    title: LocalizedText;
    body: LocalizedText;
    metaDescription: LocalizedText;
    expectedVersion: number;
  },
): Promise<PageContentSaveState> {
  const t = await dictionary();
  const title = localizedOf(input?.title);
  const body = localizedOf(input?.body);
  const metaDescription = localizedOf(input?.metaDescription);
  if (
    typeof pageId !== "string" ||
    pageId.length === 0 ||
    !isVersion(input?.expectedVersion) ||
    title === null ||
    body === null ||
    metaDescription === null
  ) {
    return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
  }
  const result = await updatePageContent(
    pageId,
    { title, body, metaDescription, expectedVersion: input.expectedVersion },
    newIdempotencyKey(),
  );
  if (result.outcome !== "ok") return saveErrorState(result, t);
  const version = result.data.version;
  return (await revalidated(pageId))
    ? { status: "success", version }
    : { status: "success", liveDelayed: true, version };
}

/** Publish, hide (back to draft, Ruling 15) or archive one page; live on the storefront. */
export async function advancePageAction(pageId: string, toStatus: string): Promise<LiveSaveState> {
  const t = await dictionary();
  if (typeof pageId !== "string" || pageId.length === 0 || !isPageStatus(toStatus)) {
    return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
  }
  const result = await advancePage(pageId, toStatus, newIdempotencyKey());
  if (result.outcome !== "ok") return saveErrorState(result, t);
  return (await revalidated(pageId))
    ? { status: "success" }
    : { status: "success", liveDelayed: true };
}
