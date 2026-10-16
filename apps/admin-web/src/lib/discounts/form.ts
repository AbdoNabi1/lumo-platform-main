import {
  isDiscountType,
  type CombinesWith,
  type DiscountDto,
  type DiscountInput,
  type DiscountType,
  type TargetScope,
} from "@/lib/api/discounts";
import { fromMinorUnits, normalizeDigits, toMinorUnits } from "@/lib/products/money";
import { isoToZoned, zonedToIso } from "./zoned-time";

/**
 * Phase 2 Part 2 — the discount form as the merchant types it. Every field is kept as typed (text),
 * so the form can hold "12." mid-typing; `toDiscountInput` turns it into the API's body and says,
 * by key, which fields are wrong. The same pure function runs in the browser (the live Summary
 * card) and in the save action (with the store currency and zone the action re-reads itself).
 */

/** Something picked in a Browse dialog: a product, category, customer or country. */
export interface PickedItem {
  readonly id: string;
  readonly label: string;
}

export interface DiscountFormValues {
  readonly type: DiscountType;
  readonly method: "code" | "automatic";
  readonly code: string;
  readonly title: string;
  readonly valueKind: "percentage" | "fixed_amount";
  readonly valueAmount: string;
  readonly appliesToKind: TargetScope;
  readonly appliesToItems: readonly PickedItem[];
  readonly appliesOncePerOrder: boolean;
  readonly buysKind: "quantity" | "amount";
  readonly buysValue: string;
  readonly buysScope: TargetScope;
  readonly buysItems: readonly PickedItem[];
  readonly getsQuantity: string;
  readonly getsScope: TargetScope;
  readonly getsItems: readonly PickedItem[];
  readonly getsEffect: "percentage" | "free";
  readonly getsPercentage: string;
  readonly limitUsesPerOrder: boolean;
  readonly maxUsesPerOrder: string;
  readonly allCountries: boolean;
  readonly countries: readonly PickedItem[];
  readonly excludeRatesOver: boolean;
  readonly maxShippingRate: string;
  readonly minimumKind: "none" | "amount" | "quantity";
  readonly minimumAmount: string;
  readonly minimumQuantity: string;
  readonly allCustomers: boolean;
  readonly customers: readonly PickedItem[];
  readonly limitTotalUses: boolean;
  readonly usageLimit: string;
  readonly oncePerCustomer: boolean;
  readonly combinesWith: CombinesWith;
  readonly startDate: string;
  readonly startTime: string;
  readonly hasEndDate: boolean;
  readonly endDate: string;
  readonly endTime: string;
}

/** Names for the ids a saved discount points at, resolved on the server. Unknown ids show as themselves. */
export interface TargetLabels {
  readonly products: Readonly<Record<string, string>>;
  readonly categories: Readonly<Record<string, string>>;
  readonly customers: Readonly<Record<string, string>>;
  readonly countries: Readonly<Record<string, string>>;
}

/** What is wrong with a field; each key has a sentence under `discounts.errors`. */
export type DiscountErrorKey =
  | "required"
  | "codeFormat"
  | "percentRange"
  | "amountInvalid"
  | "wholeNumber"
  | "chooseItems"
  | "chooseCountries"
  | "chooseCustomers"
  | "dateInvalid"
  | "endBeforeStart";

export type DiscountFieldErrors = Readonly<Record<string, DiscountErrorKey>>;

const CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

/** "10", "12.5", "١٠" → the percentage; null unless it is a number with at most two decimals. */
export function parsePercent(text: string): number | null {
  const normalized = normalizeDigits(text.trim());
  return /^\d+(\.\d{1,2})?$/.test(normalized) ? Number(normalized) : null;
}

/** A whole number above zero, Arabic digits accepted; null otherwise. */
export function parsePositiveInt(text: string): number | null {
  const normalized = normalizeDigits(text.trim());
  if (!/^\d+$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** A new discount of `type`: a code, starting now in the store's zone, combining with nothing. */
export function emptyFormValues(
  type: DiscountType,
  now: Date,
  timeZone: string,
): DiscountFormValues {
  const start = isoToZoned(now.toISOString(), timeZone);
  return {
    type,
    method: "code",
    code: "",
    title: "",
    valueKind: "percentage",
    valueAmount: "",
    appliesToKind: "products",
    appliesToItems: [],
    appliesOncePerOrder: false,
    buysKind: "quantity",
    buysValue: "",
    buysScope: "products",
    buysItems: [],
    getsQuantity: "",
    getsScope: "products",
    getsItems: [],
    getsEffect: "percentage",
    getsPercentage: "",
    limitUsesPerOrder: false,
    maxUsesPerOrder: "",
    allCountries: true,
    countries: [],
    excludeRatesOver: false,
    maxShippingRate: "",
    minimumKind: "none",
    minimumAmount: "",
    minimumQuantity: "",
    allCustomers: true,
    customers: [],
    limitTotalUses: false,
    usageLimit: "",
    oncePerCustomer: false,
    combinesWith: { product: false, order: false, shipping: false },
    startDate: start.date,
    startTime: start.time,
    hasEndDate: false,
    endDate: "",
    endTime: "",
  };
}

/** A saved discount back into the form, amounts as the merchant would type them. */
export function formValuesFromDto(
  dto: DiscountDto,
  labels: TargetLabels,
  currency: string,
  timeZone: string,
): DiscountFormValues {
  const named =
    (names: Readonly<Record<string, string>>) =>
    (id: string): PickedItem => ({ id, label: names[id] ?? id });
  const itemsOf = (scope: TargetScope, refs: readonly string[]) =>
    refs.map(named(scope === "categories" ? labels.categories : labels.products));
  const money = (minor: number) => fromMinorUnits(minor, currency);
  const start = isoToZoned(dto.startsAt, timeZone);
  const end = dto.endsAt === null ? null : isoToZoned(dto.endsAt, timeZone);
  const minimum = dto.minimumRequirement;
  const eligibility = dto.customerEligibility;
  const effect = dto.gets?.effect;

  return {
    ...emptyFormValues(dto.type, new Date(dto.startsAt), timeZone),
    method: dto.method,
    code: dto.code ?? "",
    title: dto.method === "automatic" ? dto.title : "",
    valueKind: dto.value?.kind ?? "percentage",
    valueAmount:
      dto.value === null
        ? ""
        : dto.value.kind === "percentage"
          ? String(dto.value.amount)
          : money(dto.value.amount),
    appliesToKind: dto.appliesTo?.kind ?? "products",
    appliesToItems: dto.appliesTo === null ? [] : itemsOf(dto.appliesTo.kind, dto.appliesTo.refs),
    appliesOncePerOrder: dto.appliesOncePerOrder,
    buysKind: dto.buys?.kind ?? "quantity",
    buysValue:
      dto.buys === null
        ? ""
        : dto.buys.kind === "amount"
          ? money(dto.buys.value)
          : String(dto.buys.value),
    buysScope: dto.buys?.scope ?? "products",
    buysItems: dto.buys === null ? [] : itemsOf(dto.buys.scope, dto.buys.refs),
    getsQuantity: dto.gets === null ? "" : String(dto.gets.quantity),
    getsScope: dto.gets?.scope ?? "products",
    getsItems: dto.gets === null ? [] : itemsOf(dto.gets.scope, dto.gets.refs),
    getsEffect: effect?.kind ?? "percentage",
    getsPercentage: effect?.kind === "percentage" ? String(effect.value) : "",
    limitUsesPerOrder: dto.maxUsesPerOrder !== null,
    maxUsesPerOrder: dto.maxUsesPerOrder === null ? "" : String(dto.maxUsesPerOrder),
    allCountries: dto.countries === null,
    countries: (dto.countries ?? []).map(named(labels.countries)),
    excludeRatesOver: dto.maxShippingRateMinor !== null,
    maxShippingRate: dto.maxShippingRateMinor === null ? "" : money(dto.maxShippingRateMinor),
    minimumKind: minimum.kind,
    minimumAmount: minimum.kind === "amount" ? money(minimum.amountMinor) : "",
    minimumQuantity: minimum.kind === "quantity" ? String(minimum.quantity) : "",
    allCustomers: eligibility.kind === "all",
    customers:
      eligibility.kind === "customers" ? eligibility.customerRefs.map(named(labels.customers)) : [],
    limitTotalUses: dto.usageLimit !== null,
    usageLimit: dto.usageLimit === null ? "" : String(dto.usageLimit),
    oncePerCustomer: dto.oncePerCustomer,
    combinesWith: dto.combinesWith,
    startDate: start.date,
    startTime: start.time,
    hasEndDate: end !== null,
    endDate: end?.date ?? "",
    endTime: end?.time ?? "",
  };
}

type Draft = { -readonly [K in keyof DiscountInput]: DiscountInput[K] };

const ids = (items: readonly PickedItem[]) => items.map((item) => item.id);

/**
 * The form to the API's body, plus what is wrong, by field. The body is always built from the fields
 * that read correctly, so the Summary card can follow a half-filled form; it is sent only when
 * `fieldErrors` is empty.
 */
export function toDiscountInput(
  values: DiscountFormValues,
  currency: string,
  timeZone: string,
): { readonly input: DiscountInput; readonly fieldErrors: DiscountFieldErrors } {
  const errors: Record<string, DiscountErrorKey> = {};
  const isCode = values.method === "code";
  const input: Draft = {
    type: values.type,
    method: values.method,
    minimumRequirement: { kind: "none" },
    customerEligibility: { kind: "all" },
    oncePerCustomer: isCode && values.oncePerCustomer,
    combinesWith: values.combinesWith,
    startsAt: "",
  };
  const blank = (text: string) => text.trim() === "";
  const amountOf = (text: string): number | null => {
    const minor = toMinorUnits(text, currency);
    return minor === null || minor <= 0 ? null : minor;
  };
  const percentOf = (text: string): number | null => {
    const percent = parsePercent(text);
    return percent === null || percent <= 0 || percent > 100 ? null : percent;
  };

  if (isCode) {
    const code = values.code.trim().toUpperCase();
    if (code === "") errors["code"] = "required";
    else if (!CODE_PATTERN.test(code)) errors["code"] = "codeFormat";
    else input.code = code;
  } else {
    const title = values.title.trim();
    if (title === "") errors["title"] = "required";
    else input.title = title;
  }

  if (values.type === "amount_off_products" || values.type === "amount_off_order") {
    const amount =
      values.valueKind === "percentage"
        ? percentOf(values.valueAmount)
        : amountOf(values.valueAmount);
    if (blank(values.valueAmount)) errors["value"] = "required";
    else if (amount === null)
      errors["value"] = values.valueKind === "percentage" ? "percentRange" : "amountInvalid";
    else input.value = { kind: values.valueKind, amount };
  }

  if (values.type === "amount_off_products") {
    if (values.appliesToItems.length === 0) errors["appliesTo"] = "chooseItems";
    else input.appliesTo = { kind: values.appliesToKind, refs: ids(values.appliesToItems) };
    if (values.valueKind === "fixed_amount" && values.appliesOncePerOrder) {
      input.appliesOncePerOrder = true;
    }
  }

  if (values.type === "buy_x_get_y") {
    const buysValue =
      values.buysKind === "quantity"
        ? parsePositiveInt(values.buysValue)
        : amountOf(values.buysValue);
    if (blank(values.buysValue)) errors["buys"] = "required";
    else if (buysValue === null)
      errors["buys"] = values.buysKind === "quantity" ? "wholeNumber" : "amountInvalid";
    if (values.buysItems.length === 0) errors["buysItems"] = "chooseItems";
    if (buysValue !== null && values.buysItems.length > 0) {
      input.buys = {
        kind: values.buysKind,
        value: buysValue,
        scope: values.buysScope,
        refs: ids(values.buysItems),
      };
    }

    const quantity = parsePositiveInt(values.getsQuantity);
    if (blank(values.getsQuantity)) errors["gets"] = "required";
    else if (quantity === null) errors["gets"] = "wholeNumber";
    if (values.getsItems.length === 0) errors["getsItems"] = "chooseItems";
    const percent = values.getsEffect === "percentage" ? percentOf(values.getsPercentage) : null;
    if (values.getsEffect === "percentage" && percent === null)
      errors["getsEffect"] = "percentRange";
    const effect =
      values.getsEffect === "free"
        ? ({ kind: "free" } as const)
        : percent === null
          ? null
          : ({ kind: "percentage", value: percent } as const);
    if (quantity !== null && values.getsItems.length > 0 && effect !== null) {
      input.gets = { quantity, scope: values.getsScope, refs: ids(values.getsItems), effect };
    }

    if (values.limitUsesPerOrder) {
      const max = parsePositiveInt(values.maxUsesPerOrder);
      if (max === null) errors["maxUsesPerOrder"] = "wholeNumber";
      else input.maxUsesPerOrder = max;
    }
  }

  if (values.type === "free_shipping") {
    if (!values.allCountries) {
      if (values.countries.length === 0) errors["countries"] = "chooseCountries";
      else input.countries = ids(values.countries);
    }
    if (values.excludeRatesOver) {
      const cap = toMinorUnits(values.maxShippingRate, currency);
      if (cap === null || blank(values.maxShippingRate))
        errors["maxShippingRateMinor"] = "amountInvalid";
      else input.maxShippingRateMinor = cap;
    }
  }

  if (values.type !== "buy_x_get_y") {
    if (values.minimumKind === "amount") {
      const amount = amountOf(values.minimumAmount);
      if (amount === null) errors["minimumRequirement"] = "amountInvalid";
      else input.minimumRequirement = { kind: "amount", amountMinor: amount };
    } else if (values.minimumKind === "quantity") {
      const quantity = parsePositiveInt(values.minimumQuantity);
      if (quantity === null) errors["minimumRequirement"] = "wholeNumber";
      else input.minimumRequirement = { kind: "quantity", quantity };
    }
  }

  if (!values.allCustomers) {
    if (values.customers.length === 0) errors["customerEligibility"] = "chooseCustomers";
    else input.customerEligibility = { kind: "customers", customerRefs: ids(values.customers) };
  }

  if (isCode && values.limitTotalUses) {
    const limit = parsePositiveInt(values.usageLimit);
    if (limit === null) errors["usageLimit"] = "wholeNumber";
    else input.usageLimit = limit;
  }

  const startsAt = zonedToIso(values.startDate, values.startTime, timeZone);
  if (startsAt === null) errors["startsAt"] = "dateInvalid";
  else input.startsAt = startsAt;
  if (values.hasEndDate) {
    const endsAt = zonedToIso(values.endDate, values.endTime, timeZone);
    if (endsAt === null) errors["endsAt"] = "dateInvalid";
    else if (startsAt !== null && Date.parse(endsAt) <= Date.parse(startsAt))
      errors["endsAt"] = "endBeforeStart";
    else input.endsAt = endsAt;
  }

  return { input, fieldErrors: errors };
}

const MAX_PICKED = 250;

function isPickedItem(value: unknown): value is PickedItem {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    (value as { id: string }).id !== "" &&
    typeof (value as { label?: unknown }).label === "string"
  );
}

/**
 * The editor's posted JSON, read defensively: it crossed the network, so it is not trusted. The
 * shape is rebuilt field by field; anything unreadable falls back to the empty form's value, and a
 * payload without a known type or method is rejected outright.
 */
export function parseFormValues(raw: unknown): DiscountFormValues | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const type = record["type"];
  const method = record["method"];
  if (!isDiscountType(type) || (method !== "code" && method !== "automatic")) return null;
  const empty = emptyFormValues(type, new Date(0), "UTC");
  const text = (key: keyof DiscountFormValues): string => {
    const value = record[key];
    return typeof value === "string" ? value.slice(0, 255) : "";
  };
  const flag = (key: keyof DiscountFormValues): boolean => record[key] === true;
  const items = (key: keyof DiscountFormValues): readonly PickedItem[] => {
    const value = record[key];
    return Array.isArray(value)
      ? value
          .filter(isPickedItem)
          .slice(0, MAX_PICKED)
          .map((item) => ({ id: item.id, label: item.label }))
      : [];
  };
  const oneOf = <T extends string>(
    key: keyof DiscountFormValues,
    options: readonly T[],
    fallback: T,
  ): T => {
    const value = record[key];
    return typeof value === "string" && (options as readonly string[]).includes(value)
      ? (value as T)
      : fallback;
  };
  const scope = (key: keyof DiscountFormValues) =>
    oneOf<TargetScope>(key, ["products", "categories"], "products");
  const combines =
    typeof record["combinesWith"] === "object" && record["combinesWith"] !== null
      ? (record["combinesWith"] as Record<string, unknown>)
      : {};

  return {
    ...empty,
    method,
    code: text("code"),
    title: text("title"),
    valueKind: oneOf("valueKind", ["percentage", "fixed_amount"], "percentage"),
    valueAmount: text("valueAmount"),
    appliesToKind: scope("appliesToKind"),
    appliesToItems: items("appliesToItems"),
    appliesOncePerOrder: flag("appliesOncePerOrder"),
    buysKind: oneOf("buysKind", ["quantity", "amount"], "quantity"),
    buysValue: text("buysValue"),
    buysScope: scope("buysScope"),
    buysItems: items("buysItems"),
    getsQuantity: text("getsQuantity"),
    getsScope: scope("getsScope"),
    getsItems: items("getsItems"),
    getsEffect: oneOf("getsEffect", ["percentage", "free"], "percentage"),
    getsPercentage: text("getsPercentage"),
    limitUsesPerOrder: flag("limitUsesPerOrder"),
    maxUsesPerOrder: text("maxUsesPerOrder"),
    allCountries: flag("allCountries"),
    countries: items("countries"),
    excludeRatesOver: flag("excludeRatesOver"),
    maxShippingRate: text("maxShippingRate"),
    minimumKind: oneOf("minimumKind", ["none", "amount", "quantity"], "none"),
    minimumAmount: text("minimumAmount"),
    minimumQuantity: text("minimumQuantity"),
    allCustomers: flag("allCustomers"),
    customers: items("customers"),
    limitTotalUses: flag("limitTotalUses"),
    usageLimit: text("usageLimit"),
    oncePerCustomer: flag("oncePerCustomer"),
    combinesWith: {
      product: combines["product"] === true,
      order: combines["order"] === true,
      shipping: combines["shipping"] === true,
    },
    startDate: text("startDate"),
    startTime: text("startTime"),
    hasEndDate: flag("hasEndDate"),
    endDate: text("endDate"),
    endTime: text("endTime"),
  };
}

/** The API reports issues by path ("buys.refs", "gets.effect.value"); the form shows them by field. */
export function apiFieldToFormField(path: string): string {
  const [head = "", next] = path.split(".");
  if ((head === "buys" || head === "gets") && next === "refs") return `${head}Items`;
  return head;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Shopify's "Generate random code": 12 characters, no look-alikes (0/O, 1/I). */
export function generateDiscountCode(): string {
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}
