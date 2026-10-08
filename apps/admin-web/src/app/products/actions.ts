"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { MutationResult } from "@/lib/api/client";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import {
  addProductVariant,
  archiveProduct,
  assignProductCategories,
  attachProductMedia,
  createProduct,
  deleteProduct,
  detachProductMedia,
  fetchProduct,
  publishProduct,
  removeProductVariant,
  reorderProductMedia,
  schedulePublishProduct,
  setProductBrand,
  setProductOptions,
  setProductSeo,
  unlistProduct,
  unpublishProduct,
  updateProduct,
  updateProductVariant,
  type FetchProductResult,
  type ProductOptionInput,
} from "@/lib/api/products";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import {
  PRODUCT_FIELD_NAMES,
  renameFieldErrors,
} from "@/components/products/editor/rename-field-errors";
import {
  fallbackHandle,
  generateProductSku,
  handleFromTitle,
  randomToken,
} from "@/lib/products/handles";
import { toMinorUnits } from "@/lib/products/money";
import { planOptionChange } from "@/lib/products/variant-matrix";

/**
 * `apps/admin-web`'s product write actions (Phase 1 T1.3/T1.4, rebuilt by Plan 2C-2 around the
 * one-page editor). Every action: parses `FormData` itself (never trusts a hidden field for
 * anything the server must decide), mints one `Idempotency-Key` per API call, calls the typed
 * `lib/api/products.ts` function, and projects any non-`ok` outcome through `toFormState` — never
 * a raw error message.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function stringFieldValues(formData: FormData, name: string): readonly string[] {
  return formData.getAll(name).map((value) => (typeof value === "string" ? value : ""));
}

function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

function optionalText(formData: FormData, name: string): string | null {
  const value = stringField(formData, name).trim();
  return value.length === 0 ? null : value;
}

/** Blank → null; otherwise minor units, or `undefined` when the text is not a valid amount. */
function optionalMoney(
  formData: FormData,
  name: string,
  currency: string,
): number | null | undefined {
  const raw = stringField(formData, name).trim();
  if (raw.length === 0) return null;
  return toMinorUnits(raw, currency) ?? undefined;
}

/**
 * Blank → null; grams from "250" g or "1.5" kg (string arithmetic via `toMinorUnits` with 3
 * decimals). The currency codes below only borrow an exponent: KWD has 3 decimals (kg → g) and JPY
 * has none (g stays whole).
 */
function weightGramsOf(formData: FormData): number | null | undefined {
  const raw = stringField(formData, "weight").trim();
  if (raw.length === 0) return null;
  const unit = stringField(formData, "weightUnit") === "kg" ? "kg" : "g";
  const parsed = toMinorUnits(raw, unit === "kg" ? "KWD" : "JPY");
  return parsed ?? undefined;
}

function tagsOf(formData: FormData): string[] {
  return stringField(formData, "tags")
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/** The option editor's name/values rows. Zero rows is valid: it means "remove every option". */
function parseOptions(formData: FormData): readonly ProductOptionInput[] | null {
  const names = stringFieldValues(formData, "optionName");
  const valuesList = stringFieldValues(formData, "optionValues");
  if (names.length !== valuesList.length) return null;
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

async function localeDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

async function formErrorDictionary() {
  return (await localeDictionary()).formErrors;
}

function revalidateProduct(productId: string): void {
  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
}

/** A failed `fetchProduct` as the `MutationResult` `toFormState` understands. */
function fetchFailure(
  result: Exclude<FetchProductResult, { outcome: "ok" }>,
): MutationResult<unknown> {
  return result;
}

interface ParsedVariantFields {
  readonly sku: string;
  readonly priceAmountMinor: number;
  readonly compareAtAmountMinor: number | null;
  readonly costAmountMinor: number | null;
  readonly barcode: string | null;
  readonly weightGrams: number | null;
  readonly requiresShipping: boolean;
  readonly taxable: boolean;
}

/** Reads the single-variant inputs; a bad amount or weight lands in `errors` and `values` is null. */
function parseVariantFields(
  formData: FormData,
  currency: string,
  invalid: string,
): { values: ParsedVariantFields | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const priceRaw = stringField(formData, "price").trim();
  const price = priceRaw.length === 0 ? undefined : (toMinorUnits(priceRaw, currency) ?? undefined);
  const compareAt = optionalMoney(formData, "compareAtPrice", currency);
  const cost = optionalMoney(formData, "costPerItem", currency);
  const weight = weightGramsOf(formData);
  if (price === undefined) errors["price"] = invalid;
  if (compareAt === undefined) errors["compareAtPrice"] = invalid;
  if (cost === undefined) errors["costPerItem"] = invalid;
  if (weight === undefined) errors["weight"] = invalid;
  if (
    price === undefined ||
    compareAt === undefined ||
    cost === undefined ||
    weight === undefined
  ) {
    return { values: null, errors };
  }
  return {
    values: {
      sku: stringField(formData, "sku").trim(),
      priceAmountMinor: price,
      compareAtAmountMinor: compareAt,
      costAmountMinor: cost,
      barcode: optionalText(formData, "barcode"),
      weightGrams: weight,
      requiresShipping: checkbox(formData, "requiresShipping"),
      taxable: checkbox(formData, "taxable"),
    },
    errors,
  };
}

const EDITABLE_STATUSES = ["published", "draft", "unlisted"] as const;
type EditableStatus = (typeof EDITABLE_STATUSES)[number];

function isEditableStatus(value: string): value is EditableStatus {
  return (EDITABLE_STATUSES as readonly string[]).includes(value);
}

/** The status call that moves a product to `target`, or null when nothing needs to change. */
function statusCall(
  productId: string,
  current: string,
  target: string,
): (() => Promise<MutationResult<unknown>>) | null {
  if (!isEditableStatus(current) || !isEditableStatus(target) || current === target) return null;
  if (target === "published") return () => publishProduct(productId, newIdempotencyKey());
  if (target === "unlisted") return () => unlistProduct(productId, newIdempotencyKey());
  return () => unpublishProduct(productId, newIdempotencyKey());
}

const SEO_FIELD_NAMES: Readonly<Record<string, string>> = {
  title: "seoTitle",
  description: "seoDescription",
};

interface SaveStep {
  readonly names: Readonly<Record<string, string>>;
  readonly run: () => Promise<MutationResult<unknown>>;
}

/**
 * Plan 2C-2 — the editor's single Save. Re-reads the product, then calls only the endpoints whose
 * values changed, in a fixed order (details → variant → SEO → brand → categories → status), and
 * stops at the first failure. Everything before the failure stays saved (each call is idempotent),
 * so the page revalidates to show it.
 */
export async function saveProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const dictionary = await localeDictionary();
  const t = dictionary.formErrors;
  const editor = dictionary.productEditor;

  const productId = stringField(formData, "productId");
  if (productId.length === 0) return { status: "error", message: t.invalid, fieldErrors: {} };

  const fetched = await fetchProduct(productId);
  if (fetched.outcome !== "ok") return toFormState(fetchFailure(fetched), t);
  const product = fetched.product;

  const hasVariantFields = stringField(formData, "hasVariantFields") === "1";
  const currentVariant = hasVariantFields
    ? product.variants.find((variant) => variant.id === stringField(formData, "variantId"))
    : undefined;
  if (hasVariantFields && currentVariant === undefined) {
    return toFormState({ outcome: "not_found" }, t);
  }

  const fieldErrors: Record<string, string> = {};
  const title = stringField(formData, "title").trim();
  if (title.length === 0) fieldErrors["title"] = t.invalid;

  const currency = stringField(formData, "currency").trim() || currentVariant?.currency || "EGP";
  const parsed = hasVariantFields ? parseVariantFields(formData, currency, t.invalid) : null;
  if (parsed !== null) Object.assign(fieldErrors, parsed.errors);
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const steps: SaveStep[] = [];

  // 1. Details.
  const handle = stringField(formData, "handle").trim() || product.slug;
  const description = optionalText(formData, "description");
  const productType = optionalText(formData, "productType");
  const tags = tagsOf(formData);
  if (
    title !== product.name ||
    handle !== product.slug ||
    (description ?? "") !== (product.description ?? "") ||
    (productType ?? "") !== (product.productType ?? "") ||
    tags.join(",") !== product.tags.join(",")
  ) {
    steps.push({
      names: PRODUCT_FIELD_NAMES,
      run: () =>
        updateProduct(
          productId,
          { name: title, slug: handle, description, productType, tags },
          newIdempotencyKey(),
        ),
    });
  }

  // 2. The single variant's price, identifiers and shipping.
  if (parsed !== null && parsed.values !== null && currentVariant !== undefined) {
    const values = parsed.values;
    const input = {
      sku: values.sku.length > 0 ? values.sku : currentVariant.sku,
      priceAmountMinor: values.priceAmountMinor,
      currency,
      compareAtAmountMinor: values.compareAtAmountMinor,
      costAmountMinor: values.costAmountMinor,
      barcode: values.barcode,
      weightGrams: values.weightGrams,
      requiresShipping: values.requiresShipping,
      taxable: values.taxable,
    };
    if (
      input.sku !== currentVariant.sku ||
      input.priceAmountMinor !== currentVariant.priceAmountMinor ||
      input.currency !== currentVariant.currency ||
      input.compareAtAmountMinor !== currentVariant.compareAtAmountMinor ||
      input.costAmountMinor !== currentVariant.costAmountMinor ||
      input.barcode !== currentVariant.barcode ||
      input.weightGrams !== currentVariant.weightGrams ||
      input.requiresShipping !== currentVariant.requiresShipping ||
      input.taxable !== currentVariant.taxable
    ) {
      steps.push({
        names: PRODUCT_FIELD_NAMES,
        run: () => updateProductVariant(productId, currentVariant.id, input, newIdempotencyKey()),
      });
    }
  }

  // 3. SEO.
  const seoTitle = optionalText(formData, "seoTitle");
  const seoDescription = optionalText(formData, "seoDescription");
  if (
    (seoTitle ?? "") !== (product.seoTitle ?? "") ||
    (seoDescription ?? "") !== (product.seoDescription ?? "")
  ) {
    steps.push({
      names: SEO_FIELD_NAMES,
      run: () =>
        setProductSeo(
          productId,
          { title: seoTitle ?? undefined, description: seoDescription ?? undefined },
          newIdempotencyKey(),
        ),
    });
  }

  // 4. Brand.
  const brandId = optionalText(formData, "brandId");
  if (brandId !== product.brandId) {
    steps.push({
      names: {},
      run: () => setProductBrand(productId, brandId, newIdempotencyKey()),
    });
  }

  // 5. Categories.
  const categoryIds = stringFieldValues(formData, "categoryIds").filter((id) => id.length > 0);
  if ([...categoryIds].sort().join(",") !== [...product.categoryIds].sort().join(",")) {
    steps.push({
      names: {},
      run: () => assignProductCategories(productId, categoryIds, newIdempotencyKey()),
    });
  }

  // 6. Status — last, so a publish never goes live ahead of the content that backs it. The select
  // is not rendered for archived/scheduled products, so `statusCall` ignores those.
  const moveStatus = statusCall(productId, product.status, stringField(formData, "status"));
  if (moveStatus !== null) steps.push({ names: {}, run: moveStatus });

  let savedSomething = false;
  for (const step of steps) {
    const result = await step.run();
    if (result.outcome !== "ok") {
      revalidateProduct(productId);
      const state = renameFieldErrors(toFormState(result, t), step.names);
      if (savedSomething && state.status === "error") {
        return { ...state, message: `${editor.partiallySaved} ${state.message}` };
      }
      return state;
    }
    savedSomething = true;
  }

  revalidateProduct(productId);
  return { status: "success" };
}

/**
 * Plan 2C-2 — creates a product from the same page. A blank handle and a blank SKU are generated
 * (the domain still requires them, G-98). Brand, categories, SEO and status follow the create; a
 * failure after the product exists still redirects to it, flagged `?saved=partial`.
 */
export async function createProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const fieldErrors: Record<string, string> = {};
  const title = stringField(formData, "title").trim();
  if (title.length === 0) fieldErrors["title"] = t.invalid;
  const currency = stringField(formData, "currency").trim();
  if (currency.length === 0) fieldErrors["currency"] = t.invalid;
  const parsed = parseVariantFields(formData, currency, t.invalid);
  Object.assign(fieldErrors, parsed.errors);
  if (Object.keys(fieldErrors).length > 0 || parsed.values === null) {
    return { status: "error", message: t.invalid, fieldErrors };
  }
  const values = parsed.values;

  const typedHandle = stringField(formData, "handle").trim();
  const handleWasGenerated = typedHandle.length === 0;
  let handle = typedHandle || handleFromTitle(title) || fallbackHandle();
  const productSku = generateProductSku();
  const description = optionalText(formData, "description");
  const productType = optionalText(formData, "productType");
  const tags = tagsOf(formData);

  const inputFor = (slug: string) => ({
    sku: productSku,
    name: title,
    slug,
    description,
    productType,
    tags,
    variants: [
      {
        sku: values.sku.length > 0 ? values.sku : `${productSku}-1`,
        priceAmountMinor: values.priceAmountMinor,
        currency,
        compareAtAmountMinor: values.compareAtAmountMinor,
        costAmountMinor: values.costAmountMinor,
        barcode: values.barcode,
        weightGrams: values.weightGrams,
        requiresShipping: values.requiresShipping,
        taxable: values.taxable,
      },
    ],
  });

  let result = await createProduct(inputFor(handle), newIdempotencyKey());
  if (result.outcome === "conflict" && handleWasGenerated) {
    handle = `${handle}-${randomToken(4)}`;
    result = await createProduct(inputFor(handle), newIdempotencyKey());
  }
  if (result.outcome === "conflict") {
    return {
      status: "error",
      message: result.message,
      fieldErrors: handleWasGenerated ? {} : { handle: result.message },
    };
  }
  if (result.outcome !== "ok") {
    return renameFieldErrors(toFormState(result, t), PRODUCT_FIELD_NAMES);
  }

  const id = result.data.id;
  if (id.length === 0) {
    revalidatePath("/products");
    redirect("/products");
  }

  const followUps: (() => Promise<MutationResult<unknown>>)[] = [];
  const seoTitle = optionalText(formData, "seoTitle");
  const seoDescription = optionalText(formData, "seoDescription");
  if (seoTitle !== null || seoDescription !== null) {
    followUps.push(() =>
      setProductSeo(
        id,
        { title: seoTitle ?? undefined, description: seoDescription ?? undefined },
        newIdempotencyKey(),
      ),
    );
  }
  const brandId = optionalText(formData, "brandId");
  if (brandId !== null) followUps.push(() => setProductBrand(id, brandId, newIdempotencyKey()));
  const categoryIds = stringFieldValues(formData, "categoryIds").filter((c) => c.length > 0);
  if (categoryIds.length > 0) {
    followUps.push(() => assignProductCategories(id, categoryIds, newIdempotencyKey()));
  }
  const moveStatus = statusCall(id, "draft", stringField(formData, "status"));
  if (moveStatus !== null) followUps.push(moveStatus);

  let partial = false;
  for (const run of followUps) {
    const followUp = await run();
    if (followUp.outcome !== "ok") {
      partial = true;
      break;
    }
  }

  revalidatePath("/products");
  redirect(partial ? `/products/${id}?saved=partial` : `/products/${id}`);
}

/**
 * Plan 2C-2 — the option editor. Plans the change client-side-identically (`planOptionChange`) and
 * runs its operations in order; every intermediate state is legal for the domain. Stops at the
 * first failure; what ran stays saved.
 */
export async function saveProductOptionsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const dictionary = await localeDictionary();
  const t = dictionary.formErrors;
  const editor = dictionary.productEditor;

  const productId = stringField(formData, "productId");
  if (productId.length === 0) return { status: "error", message: t.invalid, fieldErrors: {} };
  const options = parseOptions(formData);
  if (options === null) {
    return { status: "error", message: editor.invalidOptions, fieldErrors: {} };
  }

  const fetched = await fetchProduct(productId);
  if (fetched.outcome !== "ok") return toFormState(fetchFailure(fetched), t);
  const product = fetched.product;

  const plan = planOptionChange({
    productSku: product.sku,
    variants: product.variants,
    nextOptions: options,
  });
  if (!plan.ok) {
    return {
      status: "error",
      message: plan.reason === "too_many_variants" ? editor.tooManyVariants : editor.invalidOptions,
      fieldErrors: {},
    };
  }

  let ran = false;
  for (const operation of plan.operations) {
    let result: MutationResult<unknown>;
    if (operation.kind === "remove") {
      result = await removeProductVariant(productId, operation.variantId, newIdempotencyKey());
    } else if (operation.kind === "setOptions") {
      result = await setProductOptions(productId, operation.options, newIdempotencyKey());
    } else if (operation.kind === "assign") {
      const variant = product.variants.find((candidate) => candidate.id === operation.variantId);
      if (variant === undefined) {
        result = { outcome: "not_found" };
      } else {
        result = await updateProductVariant(
          productId,
          variant.id,
          {
            sku: variant.sku,
            priceAmountMinor: variant.priceAmountMinor,
            currency: variant.currency,
            selection: operation.selection,
          },
          newIdempotencyKey(),
        );
      }
    } else {
      result = await addProductVariant(
        productId,
        {
          sku: operation.sku,
          priceAmountMinor: operation.priceAmountMinor,
          currency: operation.currency,
          selection: operation.selection,
        },
        newIdempotencyKey(),
      );
    }
    if (result.outcome !== "ok") {
      revalidateProduct(productId);
      const state = toFormState(result, t);
      if (ran && state.status === "error") {
        return { ...state, message: `${editor.partiallySaved} ${state.message}` };
      }
      return state;
    }
    ran = true;
  }

  revalidateProduct(productId);
  return { status: "success" };
}

/** Plan 2C-2 — the variant dialog: the full attribute set for one variant, in its own currency. */
export async function updateVariantDetailsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const productId = stringField(formData, "productId");
  const variantId = stringField(formData, "variantId");
  if (productId.length === 0 || variantId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  const fetched = await fetchProduct(productId);
  if (fetched.outcome !== "ok") return toFormState(fetchFailure(fetched), t);
  const variant = fetched.product.variants.find((candidate) => candidate.id === variantId);
  if (variant === undefined) return toFormState({ outcome: "not_found" }, t);

  const parsed = parseVariantFields(formData, variant.currency, t.invalid);
  if (parsed.values === null) {
    return { status: "error", message: t.invalid, fieldErrors: parsed.errors };
  }
  const values = parsed.values;

  const result = await updateProductVariant(
    productId,
    variant.id,
    {
      sku: values.sku.length > 0 ? values.sku : variant.sku,
      priceAmountMinor: values.priceAmountMinor,
      currency: variant.currency,
      compareAtAmountMinor: values.compareAtAmountMinor,
      costAmountMinor: values.costAmountMinor,
      barcode: values.barcode,
      weightGrams: values.weightGrams,
      requiresShipping: values.requiresShipping,
      taxable: values.taxable,
    },
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    revalidateProduct(productId);
    return { status: "success" };
  }
  return renameFieldErrors(toFormState(result, t), PRODUCT_FIELD_NAMES);
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
