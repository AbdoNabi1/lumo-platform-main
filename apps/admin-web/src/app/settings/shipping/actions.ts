"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  addShippingRate,
  createShippingZone,
  deleteShippingRate,
  deleteShippingZone,
  updateShippingRate,
  updateShippingZone,
  type RateConditionDto,
  type ZoneCountryDto,
} from "@/lib/api/shipping-zones";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { fetchStoreSettings } from "@/lib/api/store-settings";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { toMinorUnits } from "@/lib/products/money";
import { toGrams } from "@/lib/products/weight";

/**
 * Plan 3C — Settings → Shipping and delivery. Every action follows the app's write shape: parse the
 * form defensively, mint one idempotency key per submit, call the typed `lib/api/shipping-zones.ts`
 * function and project any non-`ok` outcome through `toFormState`. The browser never sends a currency
 * or a unit: amounts are read in the STORE's currency and weight unit, fetched here from the settings.
 */

const PATH = "/settings/shipping";

async function dictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function invalid(message: string, fieldErrors: Record<string, string> = {}): FormState {
  return { status: "error", message, fieldErrors };
}

function parseCountries(raw: string): ZoneCountryDto[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const countries: ZoneCountryDto[] = [];
  for (const entry of parsed as unknown[]) {
    const candidate = entry as { code?: unknown; provinces?: unknown } | null;
    if (typeof candidate?.code !== "string") return null;
    const provinces = candidate.provinces;
    if (provinces === null) {
      countries.push({ code: candidate.code, provinces: null });
    } else if (Array.isArray(provinces) && provinces.every((p) => typeof p === "string")) {
      countries.push({ code: candidate.code, provinces: provinces });
    } else {
      return null;
    }
  }
  return countries;
}

export async function saveZoneAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const t = await dictionary();
  const countries = parseCountries(text(formData, "countries"));
  if (countries === null) {
    return invalid(t.formErrors.invalid, { countries: t.formErrors.invalid });
  }
  const input = { name: text(formData, "name").trim(), countries };
  const zoneId = text(formData, "zoneId");
  const result =
    zoneId.length > 0
      ? await updateShippingZone(zoneId, input, newIdempotencyKey())
      : await createShippingZone(input, newIdempotencyKey());
  if (result.outcome !== "ok") return toFormState(result, t.formErrors);
  revalidatePath(PATH);
  return { status: "success" };
}

export async function deleteZoneAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const zoneId = text(formData, "zoneId");
  if (zoneId.length === 0) return invalid(t.formErrors.invalid);
  const result = await deleteShippingZone(zoneId, newIdempotencyKey());
  if (result.outcome !== "ok") return toFormState(result, t.formErrors);
  revalidatePath(PATH);
  return { status: "success" };
}

export async function deleteRateAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const zoneId = text(formData, "zoneId");
  const rateId = text(formData, "rateId");
  if (zoneId.length === 0 || rateId.length === 0) return invalid(t.formErrors.invalid);
  const result = await deleteShippingRate(zoneId, rateId, newIdempotencyKey());
  if (result.outcome !== "ok") return toFormState(result, t.formErrors);
  revalidatePath(PATH);
  return { status: "success" };
}

/** A blank bound is "not set" (`undefined`); anything else must parse or it is `null`. */
function bound(raw: string, parse: (text: string) => number | null): number | null | undefined {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : parse(trimmed);
}

export async function saveRateAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const t = await dictionary();
  const zoneId = text(formData, "zoneId");
  if (zoneId.length === 0) return invalid(t.formErrors.invalid);

  const store = await fetchStoreSettings();
  if (store.outcome !== "ok") {
    return toFormState(
      store.outcome === "error" ? store : { outcome: store.outcome },
      t.formErrors,
    );
  }
  const { currency, weightUnit } = store.settings;

  const fieldErrors: Record<string, string> = {};
  const priceMinor = toMinorUnits(text(formData, "price"), currency);
  if (priceMinor === null) fieldErrors["price"] = t.formErrors.invalid;

  let condition: RateConditionDto = { type: "none" };
  const type = text(formData, "conditionType");
  if (type === "orderPrice" || type === "weight") {
    const parse =
      type === "orderPrice"
        ? (value: string) => toMinorUnits(value, currency)
        : (value: string) => toGrams(value, weightUnit);
    const min = bound(text(formData, "min"), parse);
    const max = bound(text(formData, "max"), parse);
    if (min === null) fieldErrors["min"] = t.formErrors.invalid;
    if (max === null) fieldErrors["max"] = t.formErrors.invalid;
    if (min !== null && max !== null && (min !== undefined || max !== undefined)) {
      condition =
        type === "orderPrice"
          ? {
              type,
              ...(min === undefined ? {} : { minMinor: min }),
              ...(max === undefined ? {} : { maxMinor: max }),
            }
          : {
              type,
              ...(min === undefined ? {} : { minGrams: min }),
              ...(max === undefined ? {} : { maxGrams: max }),
            };
    }
  }
  if (priceMinor === null || Object.keys(fieldErrors).length > 0) {
    return invalid(t.formErrors.invalid, fieldErrors);
  }

  const description = text(formData, "description").trim();
  const input = {
    name: text(formData, "name").trim(),
    priceMinor,
    condition,
    description: description.length === 0 ? null : description,
  };
  const rateId = text(formData, "rateId");
  const result =
    rateId.length > 0
      ? await updateShippingRate(zoneId, rateId, input, newIdempotencyKey())
      : await addShippingRate(zoneId, input, newIdempotencyKey());
  if (result.outcome !== "ok") return toFormState(result, t.formErrors);
  revalidatePath(PATH);
  return { status: "success" };
}
