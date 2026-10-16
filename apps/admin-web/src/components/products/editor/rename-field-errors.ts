import type { FormState } from "@/lib/api/mutation";

/** API field names → editor input names (Plan 2C-2), so errors land next to the right input. */
export const PRODUCT_FIELD_NAMES: Readonly<Record<string, string>> = {
  name: "title",
  slug: "handle",
  priceAmountMinor: "price",
  compareAtAmountMinor: "compareAtPrice",
  costAmountMinor: "costPerItem",
  weightGrams: "weight",
};

export function renameFieldErrors(
  state: FormState,
  names: Readonly<Record<string, string>>,
): FormState {
  if (state.status !== "error") return state;
  const fieldErrors: Record<string, string> = {};
  for (const [field, message] of Object.entries(state.fieldErrors)) {
    fieldErrors[names[field] ?? field] = message;
  }
  return { ...state, fieldErrors };
}
