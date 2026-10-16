"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import {
  deleteTaxRegion,
  updateTaxFlags,
  upsertTaxRegion,
  type ProvinceRateDto,
} from "@/lib/api/taxes";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { percentToBasisPoints } from "@/lib/taxes/rates";

/**
 * Plan 3C — Settings → Taxes and duties. The write shape every action follows: parse the form
 * defensively, mint one idempotency key per submit, call the typed `lib/api/taxes.ts` function and
 * project any non-`ok` outcome through `toFormState`. Rates are typed as percents and sent as integer
 * basis points; the API owns every rule beyond the shape.
 */

const PATH = "/settings/taxes";

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

export async function saveTaxFlagsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const result = await updateTaxFlags(
    {
      pricesIncludeTax: text(formData, "pricesIncludeTax") === "on",
      chargeTaxOnShipping: text(formData, "chargeTaxOnShipping") === "on",
    },
    newIdempotencyKey(),
  );
  if (result.outcome !== "ok") return toFormState(result, t.formErrors);
  revalidatePath(PATH);
  return { status: "success" };
}

/** `[{ code, rate }]` with the rate still typed text; `null` when it is not that shape. */
function parseOverrides(raw: string): { code: string; rate: string }[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const overrides: { code: string; rate: string }[] = [];
  for (const entry of parsed as unknown[]) {
    const candidate = entry as { code?: unknown; rate?: unknown } | null;
    if (typeof candidate?.code !== "string" || typeof candidate.rate !== "string") return null;
    overrides.push({ code: candidate.code, rate: candidate.rate });
  }
  return overrides;
}

export async function saveRegionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const country = text(formData, "country").trim();
  const overrides = parseOverrides(text(formData, "overrides"));
  if (country.length === 0 || overrides === null) return invalid(t.formErrors.invalid);

  const fieldErrors: Record<string, string> = {};
  const rateBasisPoints = percentToBasisPoints(text(formData, "rate"));
  if (rateBasisPoints === null) fieldErrors["rate"] = t.formErrors.invalid;

  const provinces: ProvinceRateDto[] = [];
  for (const override of overrides) {
    const bp = percentToBasisPoints(override.rate);
    if (bp === null) fieldErrors["overrides"] = t.formErrors.invalid;
    else provinces.push({ code: override.code, rateBasisPoints: bp });
  }
  if (rateBasisPoints === null || Object.keys(fieldErrors).length > 0) {
    return invalid(t.formErrors.invalid, fieldErrors);
  }

  const result = await upsertTaxRegion(
    country,
    { rateBasisPoints, provinces },
    newIdempotencyKey(),
  );
  if (result.outcome !== "ok") return toFormState(result, t.formErrors);
  revalidatePath(PATH);
  return { status: "success" };
}

export async function deleteRegionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const country = text(formData, "country").trim();
  if (country.length === 0) return invalid(t.formErrors.invalid);
  const result = await deleteTaxRegion(country, newIdempotencyKey());
  if (result.outcome !== "ok") return toFormState(result, t.formErrors);
  revalidatePath(PATH);
  return { status: "success" };
}
