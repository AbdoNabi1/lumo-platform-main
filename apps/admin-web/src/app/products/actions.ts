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
  fetchProductInventory,
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
  type InventoryPolicy,
  type ProductOptionDto,
  type ProductOptionInput,
  type ProductDetailDto,
} from "@/lib/api/products";
import { adjustStock, fetchWarehouses, receiveStock, registerWarehouse } from "@/lib/api/inventory";
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
import { stockByVariant, stockChange, type StockLevelDto } from "@/lib/products/stock";
import {
  MAX_OPTIONS,
  planOptionChange,
  rowKey,
  type MatrixOperation,
  type OptionPlan,
} from "@/lib/products/variant-matrix";

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

/** `optionName-<i>` / repeated `optionValue-<i>`; blank rows drop out, blank values are ignored. */
function parsePageOptions(formData: FormData): ProductOptionInput[] {
  const options: ProductOptionInput[] = [];
  for (let index = 0; index < MAX_OPTIONS; index += 1) {
    const name = stringField(formData, `optionName-${index}`).trim();
    const values = stringFieldValues(formData, `optionValue-${index}`)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (name.length === 0 && values.length === 0) continue;
    options.push({ name, values });
  }
  return options;
}

function sameOptions(
  posted: readonly ProductOptionInput[],
  current: readonly ProductOptionDto[],
): boolean {
  return (
    posted.length === current.length &&
    posted.every((option, index) => {
      const other = current[index];
      return (
        other !== undefined &&
        option.name === other.name &&
        option.values.length === other.values.length &&
        option.values.every((value, position) => value === other.values[position])
      );
    })
  );
}

/** Blank → null (no change); a whole number ≥ 0; otherwise `undefined` (invalid). */
function optionalWholeNumber(formData: FormData, name: string): number | null | undefined {
  const raw = stringField(formData, name).trim();
  if (raw.length === 0) return null;
  if (!/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}

/** The id the API echoes for a created record (`{ variantId }`, `{ warehouseId }`), if readable. */
function idOf(data: unknown, key: "variantId" | "warehouseId"): string | null {
  if (typeof data !== "object" || data === null) return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
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
  readonly tracksInventory: boolean;
  readonly inventoryPolicy: InventoryPolicy;
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
      tracksInventory: checkbox(formData, "tracksInventory"),
      inventoryPolicy: checkbox(formData, "continueSelling") ? "continue" : "deny",
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
  /** API field names → input names. A step that knows its inputs only at run time fills it then. */
  readonly names: Readonly<Record<string, string>>;
  readonly run: () => Promise<MutationResult<unknown>>;
  /** For steps that can write nothing, or part of their work: whether anything was saved. */
  readonly wroteSomething?: () => boolean;
}

type OkPlan = Extract<OptionPlan, { readonly ok: true }>;

/**
 * Runs the planner's operations in order; every intermediate state is legal for the domain. Stops
 * at the first failure; what ran stays saved. `added` maps a new row's key to the id the API gave
 * it (`POST /variants` answers `{ productId, variantId }`).
 */
async function applyOptionPlan(
  productId: string,
  product: ProductDetailDto,
  operations: readonly MatrixOperation[],
): Promise<{
  readonly result: MutationResult<unknown>;
  readonly ran: boolean;
  readonly added: ReadonlyMap<string, string>;
}> {
  const added = new Map<string, string>();
  let ran = false;
  for (const operation of operations) {
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
      if (result.outcome === "ok") {
        const variantId = idOf(result.data, "variantId");
        if (variantId !== null) added.set(rowKey(operation.selection), variantId);
      }
    }
    if (result.outcome !== "ok") return { result, ran, added };
    ran = true;
  }
  return { result: { outcome: "ok", data: null }, ran, added };
}

/** One stock edit the merchant typed: the input it came from, and which variant it is for. */
interface StockEdit {
  readonly field: string;
  readonly desired: number;
  readonly variantId: () => string | null;
}

/**
 * The only-location rule (checkout supports one location today): none yet → the first write
 * registers "Shop location"; one → use it; several → write nothing. Edits are what the merchant
 * typed as AVAILABLE; `stockChange` turns each into a receive or an adjust.
 */
async function applyStockEdits(
  productId: string,
  product: ProductDetailDto,
  edits: readonly StockEdit[],
  shopLocationName: string,
  names: Record<string, string>,
): Promise<{ readonly result: MutationResult<unknown>; readonly wrote: boolean }> {
  let wrote = false;
  const failure = (
    result: MutationResult<unknown>,
  ): { readonly result: MutationResult<unknown>; readonly wrote: boolean } => ({ result, wrote });

  const warehouses = await fetchWarehouses();
  if (warehouses.outcome === "unauthorized") return failure({ outcome: "unauthorized" });
  if (warehouses.outcome === "error") {
    return failure({ outcome: "error", message: warehouses.message });
  }
  if (warehouses.items.length > 1) return failure({ outcome: "ok", data: null });

  const location = warehouses.items[0];
  let levels: Record<string, StockLevelDto> = {};
  if (location !== undefined) {
    const inventory = await fetchProductInventory(productId);
    if (inventory.outcome === "unauthorized") return failure({ outcome: "unauthorized" });
    if (inventory.outcome === "error") {
      return failure({ outcome: "error", message: inventory.message });
    }
    levels = stockByVariant(
      inventory.rows.filter((row) => row.warehouseId === location.id),
      product.variants,
    );
  }

  let warehouseId = location?.id ?? null;
  for (const edit of edits) {
    const variantId = edit.variantId();
    if (variantId === null) {
      return failure({ outcome: "error", message: "The variant id was not returned" });
    }
    const change = stockChange(edit.desired, levels[variantId] ?? null);
    if (change.kind === "none" || change.kind === "invalid") continue;

    if (warehouseId === null) {
      const registered = await registerWarehouse(
        { code: "SHOP", name: shopLocationName },
        newIdempotencyKey(),
      );
      if (registered.outcome !== "ok") return failure(registered);
      wrote = true;
      warehouseId = idOf(registered.data, "warehouseId");
      if (warehouseId === null) {
        return failure({ outcome: "error", message: "The location id was not returned" });
      }
    }

    const result =
      change.kind === "receive"
        ? await receiveStock(
            { productId, variantId, warehouseId, quantity: change.quantity },
            newIdempotencyKey(),
          )
        : await adjustStock(
            { productId, variantId, warehouseId, onHand: change.onHand },
            newIdempotencyKey(),
          );
    if (result.outcome !== "ok") {
      names["quantity"] = edit.field;
      names["onHand"] = edit.field;
      return failure(result);
    }
    wrote = true;
  }
  return { result: { outcome: "ok", data: null }, wrote };
}

/**
 * Plan 2C-2 / 2B-2 — the editor's single Save. Re-reads the product, then calls only the endpoints
 * whose values changed, in a fixed order (details → options → the variant's fields, or per-row
 * prices → stock → SEO → brand → categories → status), and stops at the first failure. Everything
 * before the failure stays saved (each call is idempotent), so the page revalidates to show it.
 *
 * Everything the server must decide is validated BEFORE the first write: the options, the rows
 * (a hidden key per row refuses a stale page rather than writing a price to the wrong size) and
 * every price and quantity.
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

  // Options: without the options section on the page they are unchanged.
  const optionsPresent = stringField(formData, "optionsPresent") === "1";
  const postedOptions = optionsPresent ? parsePageOptions(formData) : null;
  const nextOptions: readonly ProductOptionInput[] = postedOptions ?? product.options;
  const optionsChanged = postedOptions !== null && !sameOptions(postedOptions, product.options);
  // The single variant's own cards are on the page only while there are no options.
  const singleVariant = hasVariantFields && nextOptions.length === 0;
  const rowMode = optionsPresent && nextOptions.length > 0;

  const fieldErrors: Record<string, string> = {};
  const title = stringField(formData, "title").trim();
  if (title.length === 0) fieldErrors["title"] = t.invalid;

  const currency = stringField(formData, "currency").trim() || currentVariant?.currency || "EGP";
  const parsed = singleVariant ? parseVariantFields(formData, currency, t.invalid) : null;
  if (parsed !== null) Object.assign(fieldErrors, parsed.errors);
  const singleAvailable = singleVariant ? optionalWholeNumber(formData, "available") : null;
  if (singleAvailable === undefined) fieldErrors["available"] = t.invalid;

  let plan: OkPlan | null = null;
  if (optionsPresent) {
    const planned = planOptionChange({
      productSku: product.sku,
      variants: product.variants,
      nextOptions,
    });
    if (!planned.ok) {
      return {
        status: "error",
        message:
          planned.reason === "too_many_variants" ? editor.tooManyVariants : editor.invalidOptions,
        fieldErrors: {},
      };
    }
    plan = planned;
  }

  // The rows: the page must be the one this server would render, then every number must parse.
  const rowCurrency = product.variants[0]?.currency ?? currency;
  const rowPrices: number[] = [];
  const rowAvailable: (number | null)[] = [];
  if (plan !== null && rowMode) {
    const postedKeys = Array.from(formData.keys()).filter((name) => /^row-\d+-key$/.test(name));
    const stale =
      postedKeys.length !== plan.rows.length ||
      plan.rows.some((row, index) => formData.get(`row-${index}-key`) !== rowKey(row.selection));
    if (stale) return { status: "error", message: editor.pageOutOfDate, fieldErrors: {} };

    plan.rows.forEach((_row, index) => {
      const price = toMinorUnits(stringField(formData, `row-${index}-price`), rowCurrency);
      if (price === null) fieldErrors[`row-${index}-price`] = t.invalid;
      rowPrices.push(price ?? 0);
      const available = optionalWholeNumber(formData, `row-${index}-available`);
      if (available === undefined) fieldErrors[`row-${index}-available`] = t.invalid;
      rowAvailable.push(available ?? null);
    });
  }
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

  // 2. Options: the planner's operations, in an order every step of which is legal.
  const optionRun = { ran: false, added: new Map<string, string>() };
  if (plan !== null && optionsChanged) {
    const operations = plan.operations;
    steps.push({
      names: {},
      wroteSomething: () => optionRun.ran,
      run: async () => {
        const outcome = await applyOptionPlan(productId, product, operations);
        optionRun.ran = outcome.ran;
        for (const [key, id] of outcome.added) optionRun.added.set(key, id);
        return outcome.result;
      },
    });
  }
  /** A row's variant: the one it keeps, or the one the add just created. */
  const variantIdOfRow = (index: number): string | null => {
    const row = plan?.rows[index];
    if (row === undefined) return null;
    return row.variantId ?? optionRun.added.get(rowKey(row.selection)) ?? null;
  };

  // 3. The single variant's fields, or each row's price.
  if (singleVariant && parsed !== null && parsed.values !== null && currentVariant !== undefined) {
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
      tracksInventory: values.tracksInventory,
      inventoryPolicy: values.inventoryPolicy,
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
      input.taxable !== currentVariant.taxable ||
      input.tracksInventory !== currentVariant.tracksInventory ||
      input.inventoryPolicy !== currentVariant.inventoryPolicy
    ) {
      steps.push({
        names: PRODUCT_FIELD_NAMES,
        run: () => updateProductVariant(productId, currentVariant.id, input, newIdempotencyKey()),
      });
    }
  }
  if (plan !== null && rowMode) {
    const rows = plan.rows;
    const operations = plan.operations;
    const priceEdits = rows.flatMap((row, index) => {
      const existing =
        row.variantId === null
          ? undefined
          : product.variants.find((variant) => variant.id === row.variantId);
      const created =
        existing !== undefined
          ? undefined
          : operations.find(
              (operation) =>
                operation.kind === "add" && rowKey(operation.selection) === rowKey(row.selection),
            );
      const source = existing ?? (created?.kind === "add" ? created : undefined);
      const price = rowPrices[index];
      if (source === undefined || price === undefined || price === source.priceAmountMinor) {
        return [];
      }
      return [{ index, price, sku: source.sku }];
    });
    if (priceEdits.length > 0) {
      const names: Record<string, string> = {};
      let wrote = false;
      steps.push({
        names,
        wroteSomething: () => wrote,
        run: async () => {
          for (const edit of priceEdits) {
            const variantId = variantIdOfRow(edit.index);
            if (variantId === null) {
              return { outcome: "error", message: "The variant id was not returned" };
            }
            const result = await updateProductVariant(
              productId,
              variantId,
              { sku: edit.sku, priceAmountMinor: edit.price, currency: rowCurrency },
              newIdempotencyKey(),
            );
            if (result.outcome !== "ok") {
              names["priceAmountMinor"] = `row-${edit.index}-price`;
              return result;
            }
            wrote = true;
          }
          return { outcome: "ok", data: null };
        },
      });
    }
  }

  // 4. Stock: what the merchant typed as AVAILABLE, for the tracked variants.
  const stockEdits: StockEdit[] = [];
  if (rowMode) {
    rowAvailable.forEach((desired, index) => {
      const keptId = plan?.rows[index]?.variantId ?? null;
      const tracked =
        keptId === null ||
        (product.variants.find((variant) => variant.id === keptId)?.tracksInventory ?? true);
      if (desired !== null && tracked) {
        stockEdits.push({
          field: `row-${index}-available`,
          desired,
          variantId: () => variantIdOfRow(index),
        });
      }
    });
  } else if (
    singleVariant &&
    parsed?.values?.tracksInventory === true &&
    singleAvailable !== null &&
    singleAvailable !== undefined &&
    currentVariant !== undefined
  ) {
    stockEdits.push({
      field: "available",
      desired: singleAvailable,
      variantId: () => currentVariant.id,
    });
  }
  if (stockEdits.length > 0) {
    const names: Record<string, string> = {};
    let wrote = false;
    steps.push({
      names,
      wroteSomething: () => wrote,
      run: async () => {
        const outcome = await applyStockEdits(
          productId,
          product,
          stockEdits,
          editor.shopLocation,
          names,
        );
        wrote = outcome.wrote;
        return outcome.result;
      },
    });
  }

  // 5. SEO.
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

  // 6. Brand.
  const brandId = optionalText(formData, "brandId");
  if (brandId !== product.brandId) {
    steps.push({
      names: {},
      run: () => setProductBrand(productId, brandId, newIdempotencyKey()),
    });
  }

  // 7. Categories.
  const categoryIds = stringFieldValues(formData, "categoryIds").filter((id) => id.length > 0);
  if ([...categoryIds].sort().join(",") !== [...product.categoryIds].sort().join(",")) {
    steps.push({
      names: {},
      run: () => assignProductCategories(productId, categoryIds, newIdempotencyKey()),
    });
  }

  // 8. Status — last, so a publish never goes live ahead of the content that backs it. The select
  // is not rendered for archived/scheduled products, so `statusCall` ignores those.
  const moveStatus = statusCall(productId, product.status, stringField(formData, "status"));
  if (moveStatus !== null) steps.push({ names: {}, run: moveStatus });

  let savedSomething = false;
  for (const step of steps) {
    const result = await step.run();
    const wrote =
      step.wroteSomething === undefined ? result.outcome === "ok" : step.wroteSomething();
    if (result.outcome !== "ok") {
      revalidateProduct(productId);
      const state = renameFieldErrors(toFormState(result, t), step.names);
      if ((savedSomething || wrote) && state.status === "error") {
        return { ...state, message: `${editor.partiallySaved} ${state.message}` };
      }
      return state;
    }
    if (wrote) savedSomething = true;
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
      tracksInventory: values.tracksInventory,
      inventoryPolicy: values.inventoryPolicy,
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
