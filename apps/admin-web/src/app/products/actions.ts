"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import {
  addProductVariant,
  archiveProduct,
  assignProductCategories,
  attachProductMedia,
  createProduct,
  deleteProduct,
  detachProductMedia,
  publishProduct,
  removeProductVariant,
  reorderProductMedia,
  schedulePublishProduct,
  setProductBrand,
  setProductOptions,
  setProductSeo,
  unpublishProduct,
  updateProduct,
  updateProductVariant,
  type CreateProductVariantInput,
  type ProductOptionInput,
} from "@/lib/api/products";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * `apps/admin-web`'s reference write actions (Phase 1 T1.3/T1.4 — the pattern every later write
 * screen copies). Both actions: parse `FormData` themselves (never trust a hidden field for
 * anything the server must decide), mint one `Idempotency-Key` per invocation, call the typed
 * `lib/api/products.ts` function, and project any non-`ok` outcome through `toFormState` — never
 * a raw error message.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function stringFieldValues(formData: FormData, name: string): readonly string[] {
  return formData.getAll(name).map((value) => (typeof value === "string" ? value : ""));
}

/** Empty string -> `undefined` (an omitted optional zod field), not a validation failure. */
function optionalStringField(formData: FormData, name: string): string | undefined {
  const value = stringField(formData, name).trim();
  return value.length === 0 ? undefined : value;
}

/**
 * Parses a `"Color:Red, Size:M"` free-text field into `{ Color: "Red", Size: "M" }` for the
 * variant `selection` map — there is no options/attributes picker in scope for this task (see
 * `docs/plans/BLOCKERS.md`), so operators type the pairs directly. Returns `undefined` (an
 * omitted optional field) for a blank input, and `null` for a malformed one (a segment with no
 * `:` separator) so the caller can report a field error instead of silently dropping data.
 */
function parseSelection(
  formData: FormData,
  name: string,
): Readonly<Record<string, string>> | undefined | null {
  const raw = stringField(formData, name).trim();
  if (raw.length === 0) return undefined;
  const selection: Record<string, string> = {};
  for (const segment of raw.split(",")) {
    const trimmed = segment.trim();
    if (trimmed.length === 0) continue;
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0) return null;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key.length === 0 || value.length === 0) return null;
    selection[key] = value;
  }
  return Object.keys(selection).length === 0 ? undefined : selection;
}

/** Same array-field pattern as `parseVariants`, for the options-editor's name/values rows. */
function parseOptions(formData: FormData): readonly ProductOptionInput[] | null {
  const names = stringFieldValues(formData, "optionName");
  const valuesList = stringFieldValues(formData, "optionValues");
  if (names.length === 0 || names.length !== valuesList.length) return null;
  const options: ProductOptionInput[] = [];
  for (let index = 0; index < names.length; index += 1) {
    const name = (names[index] ?? "").trim();
    const values = (valuesList[index] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (name.length === 0 || values.length === 0) return null;
    options.push({ name, values });
  }
  return options;
}

function parseVariants(formData: FormData): readonly CreateProductVariantInput[] | null {
  const skus = stringFieldValues(formData, "variantSku");
  const prices = stringFieldValues(formData, "variantPriceAmountMinor");
  const currencies = stringFieldValues(formData, "variantCurrency");
  if (skus.length === 0 || skus.length !== prices.length || skus.length !== currencies.length) {
    return null;
  }
  const variants: CreateProductVariantInput[] = [];
  for (let index = 0; index < skus.length; index += 1) {
    const sku = skus[index] ?? "";
    const priceAmountMinor = Number.parseInt(prices[index] ?? "", 10);
    const currency = currencies[index] ?? "";
    if (sku.length === 0 || Number.isNaN(priceAmountMinor) || currency.length === 0) return null;
    variants.push({ sku, priceAmountMinor, currency });
  }
  return variants;
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

export async function createProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const sku = stringField(formData, "sku");
  const name = stringField(formData, "name");
  const slug = stringField(formData, "slug");
  const variants = parseVariants(formData);

  if (sku.length === 0 || name.length === 0 || slug.length === 0 || variants === null) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: variants === null ? { variants: t.invalid } : {},
    };
  }

  const result = await createProduct({ sku, name, slug, variants }, newIdempotencyKey());

  if (result.outcome === "ok") {
    revalidatePath("/products");
    const id = result.data.id;
    redirect(id.length > 0 ? `/products/${id}` : "/products");
  }

  return toFormState(result, t);
}

export async function updateProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const productId = stringField(formData, "productId");
  const name = stringField(formData, "name");
  const slug = stringField(formData, "slug");

  if (productId.length === 0 || name.length === 0 || slug.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  const result = await updateProduct(productId, { name, slug }, newIdempotencyKey());

  if (result.outcome === "ok") {
    revalidatePath("/products");
    revalidatePath(`/products/${productId}`);
    return { status: "success" };
  }

  return toFormState(result, t);
}

// -- T5.1: the 15 write routes below (see `docs/plans/.progress/task-T5.1-brief.md`) share the
// exact shape `updateProductAction` above established: parse `FormData` defensively, mint one
// idempotency key, call the typed `lib/api/products.ts` function, `revalidatePath` both the list
// and the detail page on `ok`, otherwise `toFormState`. ---------------------------------------

export async function publishProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const productId = stringField(formData, "productId");
  if (productId.length === 0) return { status: "error", message: t.invalid, fieldErrors: {} };

  const result = await publishProduct(productId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/products");
    revalidatePath(`/products/${productId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function schedulePublishProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const productId = stringField(formData, "productId");
  const scheduledAt = stringField(formData, "scheduledAt");
  if (productId.length === 0 || scheduledAt.length === 0) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: scheduledAt.length === 0 ? { scheduledAt: t.invalid } : {},
    };
  }

  const result = await schedulePublishProduct(productId, { scheduledAt }, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/products");
    revalidatePath(`/products/${productId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function unpublishProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const productId = stringField(formData, "productId");
  if (productId.length === 0) return { status: "error", message: t.invalid, fieldErrors: {} };

  const result = await unpublishProduct(productId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/products");
    revalidatePath(`/products/${productId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function archiveProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const productId = stringField(formData, "productId");
  if (productId.length === 0) return { status: "error", message: t.invalid, fieldErrors: {} };

  const result = await archiveProduct(productId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/products");
    revalidatePath(`/products/${productId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Soft-deletes the product then navigates away — the detail page it deleted no longer applies. */
export async function deleteProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const productId = stringField(formData, "productId");
  if (productId.length === 0) return { status: "error", message: t.invalid, fieldErrors: {} };

  const result = await deleteProduct(productId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/products");
    redirect("/products");
  }
  return toFormState(result, t);
}

export async function addProductVariantAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const productId = stringField(formData, "productId");
  const sku = stringField(formData, "sku");
  const priceAmountMinor = Number.parseInt(stringField(formData, "priceAmountMinor"), 10);
  const currency = stringField(formData, "currency");
  const selection = parseSelection(formData, "selection");

  if (
    productId.length === 0 ||
    sku.length === 0 ||
    Number.isNaN(priceAmountMinor) ||
    currency.length === 0 ||
    selection === null
  ) {
    const fieldErrors: Record<string, string> = {};
    if (sku.length === 0) fieldErrors["sku"] = t.invalid;
    if (Number.isNaN(priceAmountMinor)) fieldErrors["priceAmountMinor"] = t.invalid;
    if (currency.length === 0) fieldErrors["currency"] = t.invalid;
    if (selection === null) fieldErrors["selection"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await addProductVariant(
    productId,
    { sku, priceAmountMinor, currency, selection },
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    revalidatePath("/products");
    revalidatePath(`/products/${productId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function removeProductVariantAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const productId = stringField(formData, "productId");
  const variantId = stringField(formData, "variantId");
  if (productId.length === 0 || variantId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  const result = await removeProductVariant(productId, variantId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/products");
    revalidatePath(`/products/${productId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function updateProductVariantAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const productId = stringField(formData, "productId");
  const variantId = stringField(formData, "variantId");
  const sku = stringField(formData, "sku");
  const priceAmountMinor = Number.parseInt(stringField(formData, "priceAmountMinor"), 10);
  const currency = stringField(formData, "currency");

  if (
    productId.length === 0 ||
    variantId.length === 0 ||
    sku.length === 0 ||
    Number.isNaN(priceAmountMinor) ||
    currency.length === 0
  ) {
    const fieldErrors: Record<string, string> = {};
    if (sku.length === 0) fieldErrors["sku"] = t.invalid;
    if (Number.isNaN(priceAmountMinor)) fieldErrors["priceAmountMinor"] = t.invalid;
    if (currency.length === 0) fieldErrors["currency"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await updateProductVariant(
    productId,
    variantId,
    { sku, priceAmountMinor, currency },
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    revalidatePath("/products");
    revalidatePath(`/products/${productId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Replaces the whole declared option set (draft-only on the backend — see `setProductOptions`). */
export async function setProductOptionsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const productId = stringField(formData, "productId");
  const options = parseOptions(formData);

  if (productId.length === 0 || options === null) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: options === null ? { options: t.invalid } : {},
    };
  }

  const result = await setProductOptions(productId, options, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/products");
    revalidatePath(`/products/${productId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function setProductSeoAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const productId = stringField(formData, "productId");
  if (productId.length === 0) return { status: "error", message: t.invalid, fieldErrors: {} };

  const title = optionalStringField(formData, "title");
  const description = optionalStringField(formData, "description");

  const result = await setProductSeo(productId, { title, description }, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/products");
    revalidatePath(`/products/${productId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function setProductBrandAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const productId = stringField(formData, "productId");
  if (productId.length === 0) return { status: "error", message: t.invalid, fieldErrors: {} };

  const brandId = optionalStringField(formData, "brandId") ?? null;

  const result = await setProductBrand(productId, brandId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/products");
    revalidatePath(`/products/${productId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Full replace — see `assignProductCategories`. An empty list clears every assignment. `categoryIds`
 * arrives as one repeated field (T5.7: `ProductOrganizationCard`'s categories checklist), same
 * repeated-field shape as `reorderProductMediaAction`'s `assetIds`.
 */
export async function assignProductCategoriesAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const productId = stringField(formData, "productId");
  if (productId.length === 0) return { status: "error", message: t.invalid, fieldErrors: {} };

  const categoryIds = stringFieldValues(formData, "categoryIds").filter((id) => id.length > 0);

  const result = await assignProductCategories(productId, categoryIds, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/products");
    revalidatePath(`/products/${productId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function attachProductMediaAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const productId = stringField(formData, "productId");
  const assetId = stringField(formData, "assetId");
  if (productId.length === 0 || assetId.length === 0) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: assetId.length === 0 ? { assetId: t.invalid } : {},
    };
  }

  const result = await attachProductMedia(productId, assetId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/products");
    revalidatePath(`/products/${productId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function detachProductMediaAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const productId = stringField(formData, "productId");
  const assetId = stringField(formData, "assetId");
  if (productId.length === 0 || assetId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  const result = await detachProductMedia(productId, assetId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/products");
    revalidatePath(`/products/${productId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Full reorder — `assetIds` arrives as one repeated hidden field, already in the new order. */
export async function reorderProductMediaAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const productId = stringField(formData, "productId");
  const assetIds = stringFieldValues(formData, "assetIds");
  if (productId.length === 0 || assetIds.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  const result = await reorderProductMedia(productId, assetIds, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/products");
    revalidatePath(`/products/${productId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}
