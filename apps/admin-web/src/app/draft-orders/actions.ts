"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { fetchCustomersPage } from "@/lib/api/customers";
import {
  completeDraftOrder,
  createDraftOrder,
  deleteDraftOrder,
  fetchDraftOrder,
  fetchDraftShippingRates,
  issueDraftInvoiceLink,
  updateDraftOrder,
  type DraftOrderDto,
  type DraftOrderInput,
  type DraftPayment,
  type DraftShippingRateDto,
} from "@/lib/api/draft-orders";
import { newIdempotencyKey } from "@/lib/api/mutation";
import { fetchProduct, fetchProductsPage } from "@/lib/api/products";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { recoveryLinkHref } from "@/lib/orders/abandoned-checkouts";
import { conflictCodeOf, fieldErrorsOf } from "@/lib/orders/draft-orders";
import { isolateName } from "@/lib/orders/order-timeline";

const DRAFT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT_ID = /^[\w-]{1,64}$/;
/** The picker shows this many, from the products endpoint's full page, so unsellable ones don't empty it. */
const PICKER_SIZE = 20;
const PRODUCTS_PAGE_CAP = 100;

/** The completion's 503: the order was placed, Orders has not marked the draft yet; a retry resumes. */
const ORDER_NOT_UPDATED = "ORDER_NOT_UPDATED";

async function words() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE).draftOrders.editor.errors;
}

/**
 * A refusal in the merchant's words. `code` is the API's draft code (Ruling 19) or `ORDER_NOT_UPDATED`
 * — the editor reads it to offer a retry or to reload the draft; null for everything else.
 */
export type DraftActionFailure = {
  readonly ok: false;
  readonly message: string;
  readonly code: string | null;
};

async function failureOf(
  result: { readonly outcome: string; readonly message?: string },
  invalidMessage?: string,
): Promise<DraftActionFailure> {
  const e = await words();
  const fail = (message: string, code: string | null = null): DraftActionFailure => ({
    ok: false,
    message,
    code,
  });
  if (result.outcome === "unauthorized") return fail(e.sessionExpired);
  if (result.outcome === "forbidden") return fail(e.forbidden);
  if (result.outcome === "not_found") return fail(e.notFound);
  if (result.outcome === "invalid") return fail(invalidMessage ?? e.invalid);
  if (result.outcome === "conflict") {
    const code = conflictCodeOf(result.message ?? "");
    const byCode: Readonly<Record<string, string>> = {
      VERSION_CONFLICT: e.conflict,
      DRAFT_COMPLETED: e.draftCompleted,
      ALREADY_COMPLETED: e.alreadyCompleted,
      COD_NOT_ENABLED: e.codNotEnabled,
      OUT_OF_STOCK: e.outOfStock,
      DRAFT_TOTAL_TOO_LARGE: e.totalTooLarge,
      DRAFT_BUSY: e.busy,
      PAYMENT_NOT_RECORDED: e.paymentNotRecordedNoNumber,
    };
    const message = code === null ? undefined : byCode[code];
    return message === undefined ? fail(e.generic) : fail(message, code);
  }
  return fail(e.generic);
}

export type DraftSaveResult =
  | { readonly ok: true; readonly draft: DraftOrderDto }
  | {
      readonly ok: false;
      readonly message: string;
      readonly code: string | null;
      readonly fields: Readonly<Record<string, string>>;
      readonly conflict: boolean;
    };

/** Create (no id) or replace (id + version). One idempotency key per submit. */
export async function saveDraftOrderAction(
  draftId: string | null,
  version: number | null,
  input: DraftOrderInput,
): Promise<DraftSaveResult> {
  if (draftId !== null && (!DRAFT_ID.test(draftId) || version === null)) {
    return { ok: false, message: (await words()).generic, code: null, fields: {}, conflict: false };
  }
  const result =
    draftId === null
      ? await createDraftOrder(input, newIdempotencyKey())
      : await updateDraftOrder(draftId, { ...input, version: version ?? 0 }, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/draft-orders");
    revalidatePath(`/draft-orders/${result.data.id}`);
    return { ok: true, draft: result.data };
  }
  const failure = await failureOf(result);
  return {
    ...failure,
    fields: result.outcome === "invalid" ? fieldErrorsOf(result.fields) : {},
    conflict: failure.code === "VERSION_CONFLICT",
  };
}

/**
 * Delete (soft; its invoice links stop working). Answers the outcome and the screen navigates — never
 * `redirect()` from inside an awaited action, whose client-side promise is ambiguous meanwhile.
 */
export async function deleteDraftOrderAction(
  draftId: string,
): Promise<{ readonly ok: true } | DraftActionFailure> {
  if (typeof draftId !== "string" || !DRAFT_ID.test(draftId)) {
    return { ok: false, message: (await words()).generic, code: null };
  }
  const result = await deleteDraftOrder(draftId, newIdempotencyKey());
  if (result.outcome !== "ok") return failureOf(result);
  revalidatePath("/draft-orders");
  return { ok: true };
}

/** The shop's rates for the SAVED draft's address and lines. No key: it changes nothing. */
export async function draftShippingRatesAction(
  draftId: string,
): Promise<
  { readonly ok: true; readonly rates: readonly DraftShippingRateDto[] } | DraftActionFailure
> {
  if (typeof draftId !== "string" || !DRAFT_ID.test(draftId)) {
    return { ok: false, message: (await words()).generic, code: null };
  }
  const result = await fetchDraftShippingRates(draftId);
  return result.outcome === "ok"
    ? { ok: true, rates: result.data.rates }
    : failureOf(result, (await words()).notReady);
}

/**
 * Send invoice: a NEW link per press — never idempotent, no key is sent, the token is never cached or
 * logged (binding carry 2). The URL is the shop's own domain, else `STOREFRONT_URL` (Part 3's rule).
 */
export async function sendDraftInvoiceAction(
  draftId: string,
): Promise<
  { readonly ok: true; readonly url: string; readonly shopName: string } | DraftActionFailure
> {
  const e = await words();
  if (typeof draftId !== "string" || !DRAFT_ID.test(draftId)) {
    return { ok: false, message: e.generic, code: null };
  }
  const result = await issueDraftInvoiceLink(draftId);
  if (result.outcome !== "ok") return failureOf(result, e.notReady);
  const url = recoveryLinkHref(result.data, process.env["STOREFRONT_URL"] ?? null);
  if (url === null) return { ok: false, message: e.noStoreAddress, code: null };
  revalidatePath(`/draft-orders/${draftId}`);
  revalidatePath("/draft-orders");
  return { ok: true, url, shopName: result.data.shopName };
}

/**
 * Collect payment (spec §4.6). Every call is a new submit with a NEW idempotency key: a replayed key
 * answers the cached 409/503 for 24 hours, so a retry must not reuse one (Task 7 M-3). After
 * `PAYMENT_NOT_RECORDED` the order exists and the draft already reads completed — its number is read
 * off the draft so the merchant knows which order to look at; the same action again resumes it.
 */
export async function completeDraftOrderAction(
  draftId: string,
  payment: DraftPayment,
): Promise<{ readonly ok: true; readonly orderId: string } | DraftActionFailure> {
  const e = await words();
  if (
    typeof draftId !== "string" ||
    !DRAFT_ID.test(draftId) ||
    (payment !== "paid" && payment !== "collect_on_delivery")
  ) {
    return { ok: false, message: e.generic, code: null };
  }
  const result = await completeDraftOrder(draftId, payment, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath(`/draft-orders/${draftId}`);
    revalidatePath("/draft-orders");
    revalidatePath("/orders");
    return { ok: true, orderId: result.data.orderId };
  }
  // Read by status (M-1): the route's own 503 is "the order was placed, the draft is not updated yet".
  if (result.outcome === "error" && result.status === 503) {
    return { ok: false, message: e.orderNotUpdated, code: ORDER_NOT_UPDATED };
  }
  const failure = await failureOf(result, e.notReady);
  if (failure.code === "PAYMENT_NOT_RECORDED") {
    revalidatePath(`/draft-orders/${draftId}`);
    revalidatePath("/orders");
    const draft = await fetchDraftOrder(draftId);
    const number = draft.outcome === "ok" ? (draft.data.order?.orderNumber ?? null) : null;
    if (number !== null) {
      return {
        ...failure,
        message: e.paymentNotRecorded.replace("{number}", () => isolateName(`#${number}`)),
      };
    }
  }
  return failure;
}

export interface DraftPickerProduct {
  readonly id: string;
  readonly title: string;
  readonly imageUrl: string | null;
  readonly variantCount: number;
  readonly priceMinor: number | null;
  readonly currency: string | null;
}

export interface DraftPickerVariant {
  readonly productId: string;
  readonly variantId: string;
  readonly title: string;
  readonly variantTitle: string | null;
  readonly sku: string;
  readonly priceMinor: number;
  readonly currency: string;
  readonly imageUrl: string | null;
}

/** The picker's search: only what a draft can sell (published or unlisted, Plan 2C-1). */
export async function searchDraftProductsAction(q: string): Promise<readonly DraftPickerProduct[]> {
  const query = typeof q === "string" ? q.trim().slice(0, 100) : "";
  const result = await fetchProductsPage({
    first: PRODUCTS_PAGE_CAP,
    ...(query === "" ? {} : { query }),
  });
  if (result.outcome !== "ok") return [];
  return result.items
    .filter((p) => p.status === "published" || p.status === "unlisted")
    .slice(0, PICKER_SIZE)
    .map((p) => ({
      id: p.id,
      title: p.name,
      imageUrl: p.featuredImage?.url ?? null,
      variantCount: p.variantCount,
      priceMinor: p.priceAmountMinor,
      currency: p.currency,
    }));
}

export async function draftProductVariantsAction(
  productId: string,
): Promise<readonly DraftPickerVariant[]> {
  if (typeof productId !== "string" || !PRODUCT_ID.test(productId)) return [];
  const result = await fetchProduct(productId);
  if (result.outcome !== "ok") return [];
  const p = result.product;
  const imageUrl = p.media?.[0]?.url ?? null;
  return p.variants.map((v) => ({
    productId: p.id,
    variantId: v.id,
    title: p.name,
    variantTitle:
      v.selection === null
        ? null
        : p.options
            .map((o) => v.selection?.[o.name])
            .filter((x): x is string => x !== undefined)
            .join(" / ") || null,
    sku: v.sku,
    priceMinor: v.priceAmountMinor,
    currency: v.currency,
    imageUrl: p.media?.find((m) => m.id === v.imageId)?.url ?? imageUrl,
  }));
}

export async function searchDraftCustomersAction(
  q: string,
): Promise<readonly { readonly id: string; readonly name: string; readonly email: string }[]> {
  const query = typeof q === "string" ? q.trim() : "";
  if (query.length < 2) return [];
  const result = await fetchCustomersPage({ first: 10, search: query.slice(0, 100) });
  return result.outcome === "ok"
    ? result.items.map((c) => ({ id: c.id, name: c.name, email: c.email }))
    : [];
}
