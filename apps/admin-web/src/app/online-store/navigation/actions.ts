"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isMenuHandle, type MenuItem } from "@platform/storefront-content";
import {
  createMenu,
  deleteMenu,
  searchLinkTargets,
  updateMenu,
  type LinkTargetDto,
  type LinkTargetType,
  type MenuDto,
} from "@/lib/api/online-store";
import type { MutationResult } from "@/lib/api/client";
import { newIdempotencyKey, type LiveSaveState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { saveErrorState } from "@/lib/online-store/save-errors";
import { revalidateStorefront } from "@/lib/storefront-revalidate";
import type { Dictionary } from "@/messages/en";

/** A menu save's outcome: on success the saved menu (fresh broken flags and version). */
export type MenuSaveState =
  | LiveSaveState
  | { readonly status: "success"; readonly menu: MenuDto; readonly liveDelayed?: true };

const LIST_PATH = "/online-store/navigation";
const LINK_TARGET_TYPES: readonly LinkTargetType[] = ["collection", "product", "page", "policy"];
/** The API's link-target query bound (plan Rulings). */
const LINK_TARGET_QUERY_MAX = 100;

async function dictionary(): Promise<Dictionary> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

const invalid = (t: Dictionary, fieldErrors: Record<string, string> = {}): MenuSaveState => ({
  status: "error",
  message: t.formErrors.invalid,
  fieldErrors,
});

/**
 * A refused save in the admin's language. An oversized menu is reported on the `items` field
 * (422 INVALID_CONTENT, `items: MENU_TOO_LARGE`); its copy becomes the message too, since the
 * generic "check the highlighted fields" would point at nothing.
 */
function failure(result: Exclude<MutationResult<unknown>, { outcome: "ok" }>, t: Dictionary) {
  const state = saveErrorState(result, t);
  if (state.status !== "error") return state;
  const itemsError = state.fieldErrors["items"];
  return itemsError !== undefined && state.message === t.formErrors.invalid
    ? { ...state, message: itemsError }
    : state;
}

/** After a menu write: refresh the menu screens, then the storefront's cached shell (best effort). */
async function revalidated(handle: string): Promise<boolean> {
  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${encodeURIComponent(handle)}`);
  return revalidateStorefront();
}

const isVersion = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/** `PUT /online-store/menus/:handle` with the version the editor loaded; one key per submit. */
export async function saveMenuAction(input: {
  handle: string;
  title: string;
  items: readonly MenuItem[];
  expectedVersion: number;
}): Promise<MenuSaveState> {
  const t = await dictionary();
  if (!isMenuHandle(input.handle) || !isVersion(input.expectedVersion)) return invalid(t);
  const result = await updateMenu(
    input.handle,
    { title: input.title, items: input.items, expectedVersion: input.expectedVersion },
    newIdempotencyKey(),
  );
  if (result.outcome !== "ok") return failure(result, t);
  return (await revalidated(result.data.handle))
    ? { status: "success", menu: result.data }
    : { status: "success", menu: result.data, liveDelayed: true };
}

/** `POST /online-store/menus`; on success, opens the new menu. */
export async function createMenuAction(input: {
  handle: string;
  title: string;
  items: readonly MenuItem[];
}): Promise<MenuSaveState> {
  const t = await dictionary();
  if (!isMenuHandle(input.handle) || input.handle === "new") {
    return invalid(t, { handle: t.onlineStoreNavigation.handleError });
  }
  const result = await createMenu(
    { handle: input.handle, title: input.title, items: input.items },
    newIdempotencyKey(),
  );
  if (result.outcome !== "ok") return failure(result, t);
  await revalidated(result.data.handle);
  redirect(`${LIST_PATH}/${encodeURIComponent(result.data.handle)}`);
}

/** `DELETE /online-store/menus/:handle` (no body); on success, back to the list. */
export async function deleteMenuAction(handle: string): Promise<MenuSaveState> {
  const t = await dictionary();
  if (!isMenuHandle(handle)) return invalid(t);
  const result = await deleteMenu(handle, newIdempotencyKey());
  if (result.outcome !== "ok") return failure(result, t);
  await revalidated(handle);
  redirect(LIST_PATH);
}

/** The link picker's search. Never throws: any failure is an empty list. */
export async function searchLinkTargetsAction(
  type: LinkTargetType,
  q: string,
): Promise<readonly LinkTargetDto[]> {
  if (!LINK_TARGET_TYPES.includes(type)) return [];
  const query = (typeof q === "string" ? q : "").trim().slice(0, LINK_TARGET_QUERY_MAX);
  try {
    const result = await searchLinkTargets(type, query);
    return result.outcome === "ok" ? result.data : [];
  } catch {
    return [];
  }
}
