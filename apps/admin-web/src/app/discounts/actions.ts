"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { advanceCoupon, createCoupon, redeemCoupon } from "@/lib/api/discounts";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.8 Part A — the Coupons write actions. Same shape as `app/products/actions.ts`'s reference
 * actions: parse `FormData` defensively, mint one `Idempotency-Key` per invocation, call the typed
 * `lib/api/discounts.ts` function, `revalidatePath("/discounts")` on `ok` (there is no coupon
 * detail page — see the task brief — so the list is the only stale surface), otherwise
 * `toFormState`.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Empty string -> `undefined` (an omitted optional zod field), not a validation failure. */
function optionalStringField(formData: FormData, name: string): string | undefined {
  const value = stringField(formData, name).trim();
  return value.length === 0 ? undefined : value;
}

function isCouponStatus(
  value: string,
): value is "active" | "disabled" | "expired" | "depleted" {
  return value === "active" || value === "disabled" || value === "expired" || value === "depleted";
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

export async function createCouponAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const code = stringField(formData, "code");
  const promotionRef = stringField(formData, "promotionRef");
  const multiUse = formData.get("multiUse") === "on";
  const usageLimitRaw = optionalStringField(formData, "usageLimit");
  const customerRef = optionalStringField(formData, "customerRef");
  const expiresAt = optionalStringField(formData, "expiresAt");
  const campaignRef = optionalStringField(formData, "campaignRef");

  const usageLimit = usageLimitRaw === undefined ? undefined : Number.parseInt(usageLimitRaw, 10);

  if (
    code.length === 0 ||
    promotionRef.length === 0 ||
    (usageLimitRaw !== undefined && Number.isNaN(usageLimit))
  ) {
    const fieldErrors: Record<string, string> = {};
    if (code.length === 0) fieldErrors["code"] = t.invalid;
    if (promotionRef.length === 0) fieldErrors["promotionRef"] = t.invalid;
    if (usageLimitRaw !== undefined && Number.isNaN(usageLimit)) fieldErrors["usageLimit"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await createCoupon(
    { code, promotionRef, multiUse, usageLimit, customerRef, expiresAt, campaignRef },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/discounts");
    redirect("/discounts");
  }

  return toFormState(result, t);
}

export async function advanceCouponAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const couponId = stringField(formData, "couponId");
  const toStatus = stringField(formData, "toStatus");

  if (couponId.length === 0 || !isCouponStatus(toStatus)) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  const result = await advanceCoupon(couponId, toStatus, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/discounts");
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function redeemCouponAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const code = stringField(formData, "code");
  const customerRef = stringField(formData, "customerRef");
  const orderRef = optionalStringField(formData, "orderRef");

  if (code.length === 0 || customerRef.length === 0) {
    const fieldErrors: Record<string, string> = {};
    if (code.length === 0) fieldErrors["code"] = t.invalid;
    if (customerRef.length === 0) fieldErrors["customerRef"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  // The redeem route's body carries its own `idempotencyKey` field, separate from the
  // `Idempotency-Key` HTTP header — `redeemCoupon` threads this ONE minted value into both,
  // never two different values (see its own doc comment in `lib/api/discounts.ts`).
  const result = await redeemCoupon({ code, customerRef, orderRef }, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/discounts");
    return { status: "success" };
  }
  return toFormState(result, t);
}
