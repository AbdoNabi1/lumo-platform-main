import {
  normalizePlainText,
  type ContentIssue,
  type ValidationOutcome,
} from "@platform/storefront-content";

/** What the merchant tells the template generator (spec 2.3). Nothing here is saved. */
export interface PolicyTemplateInputs {
  readonly storeName: string;
  readonly contactEmail: string;
  readonly contactPhone: string;
  readonly businessAddress: string;
  readonly returnWindowDays: number;
  readonly returnShippingPaidBy: "customer" | "store";
  readonly refundMethod: "original" | "store_credit" | "cash";
  readonly cashOnDelivery: boolean;
  readonly deliveryDays: { readonly min: number; readonly max: number };
  readonly shipsInternationally: boolean;
}

/** The 14-day return window follows Egyptian Consumer Protection Law 181/2018. */
export const DEFAULT_TEMPLATE_INPUTS: PolicyTemplateInputs = Object.freeze({
  storeName: "",
  contactEmail: "",
  contactPhone: "",
  businessAddress: "",
  returnWindowDays: 14,
  returnShippingPaidBy: "customer",
  refundMethod: "original",
  cashOnDelivery: true,
  deliveryDays: Object.freeze({ min: 2, max: 5 }),
  shipsInternationally: false,
});

const KEYS = [
  "storeName",
  "contactEmail",
  "contactPhone",
  "businessAddress",
  "returnWindowDays",
  "returnShippingPaidBy",
  "refundMethod",
  "cashOnDelivery",
  "deliveryDays",
  "shipsInternationally",
] as const;
type InputKey = (typeof KEYS)[number];
const DELIVERY_KEYS: readonly string[] = ["min", "max"];
const MAX_REPORTED = 20;
const KEY_ECHO_MAX = 40;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const shown = (key: string): string =>
  key.length > KEY_ECHO_MAX ? `${key.slice(0, KEY_ECHO_MAX)}...` : key;

/** Untrusted input to `PolicyTemplateInputs`: absent keys take the defaults, every problem is reported. */
export function readTemplateInputs(raw: unknown): ValidationOutcome<PolicyTemplateInputs> {
  const issues: ContentIssue[] = [];
  const report = (path: string, code: string) => {
    if (issues.length < MAX_REPORTED) issues.push({ path, code });
  };
  const source = raw === undefined ? {} : raw;
  if (!isRecord(source)) return { ok: false, issues: [{ path: "inputs", code: "INVALID_VALUE" }] };
  const d = DEFAULT_TEMPLATE_INPUTS;

  const text = (key: InputKey, max: number, fallback: string): string => {
    const value = source[key];
    if (value === undefined) return fallback;
    if (typeof value !== "string") {
      report(`inputs.${key}`, "INVALID_VALUE");
      return fallback;
    }
    const normalized = normalizePlainText(value);
    if (normalized.length > max) report(`inputs.${key}`, "TOO_LONG");
    return normalized;
  };
  const whole = (
    container: Record<string, unknown>,
    key: string,
    path: string,
    min: number,
    max: number,
    fallback: number,
  ): number => {
    const value = container[key];
    if (value === undefined) return fallback;
    if (typeof value !== "number") {
      report(path, "INVALID_VALUE");
      return fallback;
    }
    if (!Number.isInteger(value) || value < min || value > max) {
      report(path, "OUT_OF_RANGE");
      return fallback;
    }
    return value;
  };
  const choice = <T extends string>(key: InputKey, allowed: readonly T[], fallback: T): T => {
    const value = source[key];
    if (value === undefined) return fallback;
    const found = allowed.find((option) => option === value);
    if (found === undefined) report(`inputs.${key}`, "INVALID_VALUE");
    return found ?? fallback;
  };
  const flag = (key: InputKey, fallback: boolean): boolean => {
    const value = source[key];
    if (value === undefined) return fallback;
    if (typeof value !== "boolean") {
      report(`inputs.${key}`, "INVALID_VALUE");
      return fallback;
    }
    return value;
  };

  for (const key of Object.keys(source)) {
    if (!(KEYS as readonly string[]).includes(key)) report(`inputs.${shown(key)}`, "UNKNOWN_KEY");
  }

  const storeName = text("storeName", 120, d.storeName);
  const contactEmail = text("contactEmail", 254, d.contactEmail);
  const contactPhone = text("contactPhone", 30, d.contactPhone);
  const businessAddress = text("businessAddress", 500, d.businessAddress);
  const returnWindowDays = whole(
    source,
    "returnWindowDays",
    "inputs.returnWindowDays",
    0,
    365,
    d.returnWindowDays,
  );
  const returnShippingPaidBy = choice(
    "returnShippingPaidBy",
    ["customer", "store"] as const,
    d.returnShippingPaidBy,
  );
  const refundMethod = choice(
    "refundMethod",
    ["original", "store_credit", "cash"] as const,
    d.refundMethod,
  );
  const cashOnDelivery = flag("cashOnDelivery", d.cashOnDelivery);
  const shipsInternationally = flag("shipsInternationally", d.shipsInternationally);

  let deliveryDays = { min: d.deliveryDays.min, max: d.deliveryDays.max };
  const rawDays = source["deliveryDays"];
  if (rawDays !== undefined) {
    if (!isRecord(rawDays)) {
      report("inputs.deliveryDays", "INVALID_VALUE");
    } else {
      for (const key of Object.keys(rawDays)) {
        if (!DELIVERY_KEYS.includes(key))
          report(`inputs.deliveryDays.${shown(key)}`, "UNKNOWN_KEY");
      }
      const min = whole(rawDays, "min", "inputs.deliveryDays.min", 1, 60, d.deliveryDays.min);
      // The maximum cannot sit below the minimum that was just read.
      const max = whole(
        rawDays,
        "max",
        "inputs.deliveryDays.max",
        min,
        90,
        Math.max(min, d.deliveryDays.max),
      );
      deliveryDays = { min, max };
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      storeName,
      contactEmail,
      contactPhone,
      businessAddress,
      returnWindowDays,
      returnShippingPaidBy,
      refundMethod,
      cashOnDelivery,
      deliveryDays,
      shipsInternationally,
    },
  };
}
