"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import {
  adjustStock,
  commitReservation,
  deactivateWarehouse,
  receiveStock,
  registerWarehouse,
  releaseReservation,
  reserveStock,
  transferStock,
} from "@/lib/api/inventory";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { handleFromTitle, randomToken } from "@/lib/products/handles";

/**
 * T5.5's Inventory/Warehouse write actions (the location ones are by name since Plan 2B-3). Kept in this route's own `app/inventory/actions.ts`
 * (not `app/products/actions.ts`), even though `receiveStockAction`/`adjustStockAction` render
 * inside `ProductInventoryCard` on the Product Detail page — per the task brief, Server Actions
 * don't need to live under the route that renders them, and this keeps `products/actions.ts` from
 * ballooning across two domains. Same shape every write action in this app follows
 * (`app/products/actions.ts`'s own reference doc comment): parse `FormData` defensively (never
 * trust a hidden field for anything the server must decide), mint exactly one idempotency key per
 * submit, call the typed `lib/api/inventory.ts` function, and project any non-`ok` outcome through
 * `toFormState`.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function intField(formData: FormData, name: string): number {
  return Number.parseInt(stringField(formData, name), 10);
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

/**
 * Revalidates every screen that reads a product's stock — just `ProductInventoryCard`'s own page
 * today (there is no `/inventory` list screen backing this data, per `docs/plans/BLOCKERS.md`'s
 * T5.5 entry, so there is nothing else to revalidate for a product-scoped inventory write).
 */
function revalidateProductInventory(productId: string): void {
  revalidatePath(`/products/${productId}`);
}

export async function receiveStockAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const productId = stringField(formData, "productId");
  const warehouseId = stringField(formData, "warehouseId");
  const quantity = intField(formData, "quantity");

  if (
    productId.length === 0 ||
    warehouseId.length === 0 ||
    Number.isNaN(quantity) ||
    quantity <= 0
  ) {
    const fieldErrors: Record<string, string> = {};
    if (warehouseId.length === 0) fieldErrors["warehouseId"] = t.invalid;
    if (Number.isNaN(quantity) || quantity <= 0) fieldErrors["quantity"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await receiveStock({ productId, warehouseId, quantity }, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateProductInventory(productId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function adjustStockAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const productId = stringField(formData, "productId");
  const warehouseId = stringField(formData, "warehouseId");
  const onHand = intField(formData, "onHand");

  if (productId.length === 0 || warehouseId.length === 0 || Number.isNaN(onHand) || onHand < 0) {
    const fieldErrors: Record<string, string> = {};
    if (warehouseId.length === 0) fieldErrors["warehouseId"] = t.invalid;
    if (Number.isNaN(onHand) || onHand < 0) fieldErrors["onHand"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await adjustStock({ productId, warehouseId, onHand }, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateProductInventory(productId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function reserveStockAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const productId = stringField(formData, "productId");
  const warehouseId = stringField(formData, "warehouseId");
  const quantity = intField(formData, "quantity");
  const reference = stringField(formData, "reference");

  if (
    productId.length === 0 ||
    warehouseId.length === 0 ||
    Number.isNaN(quantity) ||
    quantity <= 0 ||
    reference.length === 0
  ) {
    const fieldErrors: Record<string, string> = {};
    if (productId.length === 0) fieldErrors["productId"] = t.invalid;
    if (warehouseId.length === 0) fieldErrors["warehouseId"] = t.invalid;
    if (Number.isNaN(quantity) || quantity <= 0) fieldErrors["quantity"] = t.invalid;
    if (reference.length === 0) fieldErrors["reference"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await reserveStock(
    { productId, warehouseId, quantity, reference },
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    revalidateProductInventory(productId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function releaseReservationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const productId = stringField(formData, "productId");
  const warehouseId = stringField(formData, "warehouseId");
  const reservationId = stringField(formData, "reservationId");

  if (productId.length === 0 || warehouseId.length === 0 || reservationId.length === 0) {
    const fieldErrors: Record<string, string> = {};
    if (productId.length === 0) fieldErrors["productId"] = t.invalid;
    if (warehouseId.length === 0) fieldErrors["warehouseId"] = t.invalid;
    if (reservationId.length === 0) fieldErrors["reservationId"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await releaseReservation(
    { productId, warehouseId, reservationId },
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    revalidateProductInventory(productId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function commitReservationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const productId = stringField(formData, "productId");
  const warehouseId = stringField(formData, "warehouseId");
  const reservationId = stringField(formData, "reservationId");

  if (productId.length === 0 || warehouseId.length === 0 || reservationId.length === 0) {
    const fieldErrors: Record<string, string> = {};
    if (productId.length === 0) fieldErrors["productId"] = t.invalid;
    if (warehouseId.length === 0) fieldErrors["warehouseId"] = t.invalid;
    if (reservationId.length === 0) fieldErrors["reservationId"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await commitReservation(
    { productId, warehouseId, reservationId },
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    revalidateProductInventory(productId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function transferStockAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const productId = stringField(formData, "productId");
  const sourceWarehouseId = stringField(formData, "sourceWarehouseId");
  const destinationWarehouseId = stringField(formData, "destinationWarehouseId");
  const quantity = intField(formData, "quantity");

  if (
    productId.length === 0 ||
    sourceWarehouseId.length === 0 ||
    destinationWarehouseId.length === 0 ||
    Number.isNaN(quantity) ||
    quantity <= 0
  ) {
    const fieldErrors: Record<string, string> = {};
    if (productId.length === 0) fieldErrors["productId"] = t.invalid;
    if (sourceWarehouseId.length === 0) fieldErrors["sourceWarehouseId"] = t.invalid;
    if (destinationWarehouseId.length === 0) fieldErrors["destinationWarehouseId"] = t.invalid;
    if (Number.isNaN(quantity) || quantity <= 0) fieldErrors["quantity"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await transferStock(
    { productId, sourceWarehouseId, destinationWarehouseId, quantity },
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    revalidateProductInventory(productId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Plan 2B-3 — adds a stock location by name. The code the API still requires is derived from the
 * name (`handleFromTitle`, upper-cased), or `LOC-XXXX` for a name with no Latin letters; if that
 * code is already taken, one more attempt appends a short random suffix.
 */
export async function addLocationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const name = stringField(formData, "name").trim();

  if (name.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: { name: t.invalid } };
  }

  const derived = handleFromTitle(name).toUpperCase();
  const code = derived.length > 0 ? derived : `LOC-${randomToken(4).toUpperCase()}`;
  let result = await registerWarehouse({ code, name }, newIdempotencyKey());
  if (result.outcome === "conflict") {
    result = await registerWarehouse(
      { code: `${code}-${randomToken(4).toUpperCase()}`, name },
      newIdempotencyKey(),
    );
  }
  if (result.outcome === "ok") {
    revalidatePath("/inventory");
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function deactivateLocationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const warehouseId = stringField(formData, "warehouseId");

  if (warehouseId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: { warehouseId: t.invalid } };
  }

  const result = await deactivateWarehouse(warehouseId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/inventory");
    return { status: "success" };
  }
  return toFormState(result, t);
}
