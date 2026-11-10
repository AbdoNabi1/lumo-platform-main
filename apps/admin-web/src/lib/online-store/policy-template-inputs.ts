import { normalizePlainText, POLICY_TEMPLATE_LIMITS } from "@platform/storefront-content";
import type { PolicyTemplateInputsDto } from "@/lib/api/online-store";
import type { Dictionary } from "@/messages/en";

/**
 * The template generator's input rules: the limits come from `@platform/storefront-content`, the
 * same object the API's reader (`services/online-store/.../template-inputs.ts`) uses. The dialog caps and checks with them before sending, and the action checks an
 * untrusted caller's inputs with them before calling the API (review I-2, M-5).
 */
export const TEMPLATE_TEXT_MAX = POLICY_TEMPLATE_LIMITS.text;
type TextKey = keyof typeof TEMPLATE_TEXT_MAX;
const TEXT_KEYS = Object.keys(TEMPLATE_TEXT_MAX) as TextKey[];
const DAY_FIELDS: readonly string[] = ["returnWindowDays", "deliveryDays.min", "deliveryDays.max"];
const KEYS: readonly string[] = [
  ...TEXT_KEYS,
  "returnWindowDays",
  "returnShippingPaidBy",
  "refundMethod",
  "cashOnDelivery",
  "deliveryDays",
  "shipsInternationally",
];

export interface TemplateInputIssue {
  /** The API's path without its `inputs.` prefix (`contactPhone`, `deliveryDays.max`). */
  readonly field: string;
  readonly code: "TOO_LONG" | "INVALID_VALUE" | "OUT_OF_RANGE" | "UNKNOWN_KEY";
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Every way `raw` breaks the API's rules; empty when it is a valid `PolicyTemplateInputsDto`. */
export function templateInputIssues(raw: unknown): readonly TemplateInputIssue[] {
  if (!isRecord(raw)) return [{ field: "inputs", code: "INVALID_VALUE" }];
  const issues: TemplateInputIssue[] = [];
  for (const key of TEXT_KEYS) {
    const value = raw[key];
    if (typeof value !== "string") issues.push({ field: key, code: "INVALID_VALUE" });
    else if (normalizePlainText(value).length > TEMPLATE_TEXT_MAX[key]) {
      issues.push({ field: key, code: "TOO_LONG" });
    }
  }
  const whole = (value: unknown, field: string, min: number, max: number): number | null => {
    if (typeof value !== "number") {
      issues.push({ field, code: "INVALID_VALUE" });
      return null;
    }
    if (!Number.isInteger(value) || value < min || value > max) {
      issues.push({ field, code: "OUT_OF_RANGE" });
      return null;
    }
    return value;
  };
  whole(raw["returnWindowDays"], "returnWindowDays", ...POLICY_TEMPLATE_LIMITS.returnWindowDays);
  if (raw["returnShippingPaidBy"] !== "customer" && raw["returnShippingPaidBy"] !== "store") {
    issues.push({ field: "returnShippingPaidBy", code: "INVALID_VALUE" });
  }
  if (!["original", "store_credit", "cash"].includes(raw["refundMethod"] as string)) {
    issues.push({ field: "refundMethod", code: "INVALID_VALUE" });
  }
  if (typeof raw["cashOnDelivery"] !== "boolean") {
    issues.push({ field: "cashOnDelivery", code: "INVALID_VALUE" });
  }
  const days = raw["deliveryDays"];
  if (!isRecord(days) || Object.keys(days).some((key) => key !== "min" && key !== "max")) {
    issues.push({ field: "deliveryDays", code: "INVALID_VALUE" });
  } else {
    const min = whole(days["min"], "deliveryDays.min", ...POLICY_TEMPLATE_LIMITS.deliveryMin);
    // The maximum cannot sit below the minimum (as the API reads it).
    whole(days["max"], "deliveryDays.max", min ?? 1, POLICY_TEMPLATE_LIMITS.deliveryMaxCap);
  }
  if (typeof raw["shipsInternationally"] !== "boolean") {
    issues.push({ field: "shipsInternationally", code: "INVALID_VALUE" });
  }
  for (const key of Object.keys(raw)) {
    if (!KEYS.includes(key)) issues.push({ field: key, code: "UNKNOWN_KEY" });
  }
  return issues;
}

export function isTemplateInputs(raw: unknown): raw is PolicyTemplateInputsDto {
  return templateInputIssues(raw).length === 0;
}

/**
 * A refusal as the dialog shows it, in the admin's language: a text answer that is too long says
 * so on its own field; a day count keeps `policies.templateInvalid` (the only copy about day
 * counts); anything else is the generic "check the highlighted fields". `fieldErrors` is keyed
 * by the API path without `inputs.`. Accepts the API's `{ field, message }` issues too.
 */
export function templateErrorState(
  issues: readonly { readonly field: string; readonly code?: string; readonly message?: string }[],
  t: Dictionary,
): { readonly message: string; readonly fieldErrors: Readonly<Record<string, string>> } {
  const fieldErrors: Record<string, string> = {};
  let onlyDays = issues.length > 0;
  for (const issue of issues) {
    const field = issue.field.replace(/^inputs\./, "");
    const code = issue.code ?? issue.message ?? "";
    if ((TEXT_KEYS as readonly string[]).includes(field)) {
      fieldErrors[field] =
        code === "TOO_LONG" ? t.onlineStorePreferences.tooLong : t.formErrors.invalid;
      onlyDays = false;
    } else if (DAY_FIELDS.includes(field)) {
      fieldErrors[field] = t.policies.templateInvalid;
    } else {
      onlyDays = false;
    }
  }
  return { message: onlyDays ? t.policies.templateInvalid : t.formErrors.invalid, fieldErrors };
}
