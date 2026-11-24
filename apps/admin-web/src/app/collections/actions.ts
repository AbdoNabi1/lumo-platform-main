"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addCollectionProduct,
  createCollection,
  deleteCollection,
  publishCollection,
  removeCollectionProduct,
  renameCollection,
  reorderCollectionProducts,
  unpublishCollection,
} from "@/lib/api/collections";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { fetchProductsPage } from "@/lib/api/products";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/**
 * Shopify parity Wave 1a — the Collections write actions, in the shape of `app/brands/actions.ts`:
 * parse `FormData` defensively, mint one `Idempotency-Key` per invocation, call
 * `lib/api/collections.ts`, then — for EVERY write that reached the API, whatever its outcome —
 * revalidate the list and the collection's own page (a conflict or a 403 may still mean the screen
 * is stale), and finally map the result with `toFormState`.
 */

const NAME_MAX = 255;
const PICKER_SIZE = 20;
const PICKER_FETCH = 50;

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function dictionary(): Promise<Dictionary> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

function invalid(t: Dictionary, fieldErrors: Record<string, string> = {}): FormState {
  return { status: "error", message: t.formErrors.invalid, fieldErrors };
}

/** The list and the collection's own page — what any write to one collection makes stale. */
function revalidateCollection(id: string): void {
  revalidatePath("/collections");
  revalidatePath(`/collections/${id}`);
}

export async function createCollectionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const name = stringField(formData, "name").trim();
  const slug = stringField(formData, "slug").trim();
  if (name.length === 0 || slug.length === 0 || name.length > NAME_MAX || slug.length > NAME_MAX) {
    const fieldErrors: Record<string, string> = {};
    if (name.length === 0 || name.length > NAME_MAX) fieldErrors["name"] = t.formErrors.invalid;
    if (slug.length === 0 || slug.length > NAME_MAX) fieldErrors["slug"] = t.formErrors.invalid;
    return invalid(t, fieldErrors);
  }

  const result = await createCollection({ name, slug }, newIdempotencyKey());
  revalidatePath("/collections");
  if (result.outcome === "ok") {
    revalidatePath(`/collections/${result.data.id}`);
    redirect(`/collections/${encodeURIComponent(result.data.id)}`);
  }
  return toFormState(result, t.formErrors);
}

export async function renameCollectionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const collectionId = stringField(formData, "collectionId");
  const name = stringField(formData, "name").trim();
  if (collectionId === "" || name.length === 0 || name.length > NAME_MAX) {
    return invalid(
      t,
      name.length === 0 || name.length > NAME_MAX ? { name: t.formErrors.invalid } : {},
    );
  }

  const result = await renameCollection(collectionId, name, newIdempotencyKey());
  revalidateCollection(collectionId);
  return toFormState(result, t.formErrors);
}

/** Active ↔ Draft: `value` is `published` (publish) or `draft` (unpublish). */
export async function setCollectionStatusAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const collectionId = stringField(formData, "collectionId");
  const value = stringField(formData, "value");
  if (collectionId === "" || (value !== "published" && value !== "draft")) return invalid(t);

  const key = newIdempotencyKey();
  const result =
    value === "published"
      ? await publishCollection(collectionId, key)
      : await unpublishCollection(collectionId, key);
  revalidateCollection(collectionId);
  return toFormState(result, t.formErrors);
}

export async function addCollectionProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const collectionId = stringField(formData, "collectionId");
  const productId = stringField(formData, "productId");
  if (collectionId === "" || productId === "") return invalid(t);

  const result = await addCollectionProduct(collectionId, productId, newIdempotencyKey());
  revalidateCollection(collectionId);
  return toFormState(result, t.formErrors);
}

export async function removeCollectionProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const collectionId = stringField(formData, "collectionId");
  const productId = stringField(formData, "productId");
  if (collectionId === "" || productId === "") return invalid(t);

  const result = await removeCollectionProduct(collectionId, productId, newIdempotencyKey());
  revalidateCollection(collectionId);
  return toFormState(result, t.formErrors);
}

/**
 * Moves one member a step. The form carries the collection's COMPLETE ordered `productIds` (one
 * `productIds` entry each), so the permutation is computed against the whole collection — a move
 * across a page boundary works — and `reorder` always receives every id.
 */
export async function moveCollectionProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const collectionId = stringField(formData, "collectionId");
  const productId = stringField(formData, "productId");
  const direction = stringField(formData, "direction");
  const productIds = formData
    .getAll("productIds")
    .filter((v): v is string => typeof v === "string");
  if (collectionId === "" || productId === "" || (direction !== "up" && direction !== "down")) {
    return invalid(t);
  }

  const index = productIds.indexOf(productId);
  if (index === -1) {
    return { status: "error", message: t.collections.errors.notInCollection, fieldErrors: {} };
  }
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0) {
    return { status: "error", message: t.collections.errors.alreadyFirst, fieldErrors: {} };
  }
  if (target >= productIds.length) {
    return { status: "error", message: t.collections.errors.alreadyLast, fieldErrors: {} };
  }

  const next = [...productIds];
  next[index] = productIds[target] as string;
  next[target] = productId;

  const result = await reorderCollectionProducts(collectionId, next, newIdempotencyKey());
  revalidateCollection(collectionId);
  return toFormState(result, t.formErrors);
}

export async function deleteCollectionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const collectionId = stringField(formData, "collectionId");
  if (collectionId === "") return invalid(t);

  const result = await deleteCollection(collectionId, newIdempotencyKey());
  revalidateCollection(collectionId);
  if (result.outcome === "ok") redirect("/collections");
  return toFormState(result, t.formErrors);
}

export interface CollectionPickerProduct {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

/**
 * The picker's search. Unlike the draft-order picker it lists EVERY product — a collection may hold
 * drafts — and never fetches variants: the merchant picks a product, not a variant.
 */
export async function searchCollectionProductsAction(
  q: string,
): Promise<readonly CollectionPickerProduct[]> {
  const query = typeof q === "string" ? q.trim().slice(0, 100) : "";
  const result = await fetchProductsPage({
    first: PICKER_FETCH,
    ...(query === "" ? {} : { query }),
  });
  if (result.outcome !== "ok") return [];
  return result.items
    .map((p) => ({ id: p.id, name: p.name, status: p.status }))
    .slice(0, PICKER_SIZE);
}
