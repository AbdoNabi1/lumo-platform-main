import type {
  CombinesWith,
  DiscountBuys,
  DiscountGets,
  DiscountTargets,
  DiscountType,
  DiscountValue,
  MinimumRequirement,
} from "@/lib/api/discounts";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { formatZonedDate } from "./zoned-time";

/**
 * Shopify's discount summary — the one line under a discount in the list ("10% off entire order •
 * Minimum purchase of EGP 200.00") and the bullet list of the form's Summary card. Both a saved
 * `DiscountDto` and the form's live `DiscountInput` fit `DiscountSummarySource`.
 */
export interface DiscountSummarySource {
  readonly type: DiscountType;
  readonly value?: DiscountValue | null | undefined;
  readonly appliesTo?: DiscountTargets | null | undefined;
  readonly appliesOncePerOrder?: boolean | undefined;
  readonly buys?: DiscountBuys | null | undefined;
  readonly gets?: DiscountGets | null | undefined;
  readonly maxUsesPerOrder?: number | null | undefined;
  readonly countries?: readonly string[] | null | undefined;
  readonly maxShippingRateMinor?: number | null | undefined;
  readonly minimumRequirement: MinimumRequirement;
  readonly customerEligibility: { readonly kind: "all" | "customers" };
  readonly usageLimit?: number | null | undefined;
  readonly oncePerCustomer: boolean;
  readonly combinesWith: CombinesWith;
  readonly startsAt: string;
  readonly endsAt?: string | null | undefined;
}

export interface SummaryContext {
  readonly t: Dictionary["discounts"]["summary"];
  readonly locale: Locale;
  readonly currency: string;
  readonly timeZone: string;
}

type PluralForms = Readonly<Record<Intl.LDMLPluralRule, string>>;

/** "1 item" / "3 items" / "منتجين" — the form comes from the locale's own plural rules. */
export function pluralCount(forms: PluralForms, count: number, locale: Locale): string {
  const form = forms[new Intl.PluralRules(locale).select(count)];
  return form.replace("{count}", formatNumber(locale, count));
}

/** 10 → "10%", 12.5 → "12.5%" in the locale's digits. */
export function percentText(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(
    value / 100,
  );
}

function valueText(value: DiscountValue, ctx: SummaryContext): string {
  return value.kind === "percentage"
    ? percentText(ctx.locale, value.amount)
    : formatCurrency(ctx.locale, value.amount, ctx.currency);
}

/** The discount's headline: what it takes off, on what. Null while the form has no value yet. */
export function valueLine(src: DiscountSummarySource, ctx: SummaryContext): string | null {
  const { t } = ctx;
  switch (src.type) {
    case "amount_off_products":
      if (src.value == null) return null;
      return (src.appliesTo?.kind === "categories" ? t.offCategories : t.offProducts).replace(
        "{value}",
        valueText(src.value, ctx),
      );
    case "amount_off_order":
      if (src.value == null) return null;
      return t.offOrder.replace("{value}", valueText(src.value, ctx));
    case "buy_x_get_y": {
      const parts: string[] = [];
      if (src.buys != null) {
        parts.push(
          src.buys.kind === "quantity"
            ? t.buyItems.replace("{items}", pluralCount(t.items, src.buys.value, ctx.locale))
            : t.spendAmount.replace(
                "{amount}",
                formatCurrency(ctx.locale, src.buys.value, ctx.currency),
              ),
        );
      }
      if (src.gets != null) {
        const items = pluralCount(t.items, src.gets.quantity, ctx.locale);
        parts.push(
          src.gets.effect.kind === "free"
            ? t.getFree.replace("{items}", items)
            : t.getPercent
                .replace("{items}", items)
                .replace("{value}", percentText(ctx.locale, src.gets.effect.value)),
        );
      }
      return parts.length === 0 ? null : parts.join(" • ");
    }
    case "free_shipping":
      return src.countries == null ? t.freeShippingAll : t.freeShippingSome;
  }
}

function minimumLine(src: DiscountSummarySource, ctx: SummaryContext): string | null {
  if (src.type === "buy_x_get_y") return null;
  const minimum = src.minimumRequirement;
  if (minimum.kind === "amount") {
    return ctx.t.minimumAmount.replace(
      "{amount}",
      formatCurrency(ctx.locale, minimum.amountMinor, ctx.currency),
    );
  }
  if (minimum.kind === "quantity") {
    return ctx.t.minimumQuantity.replace(
      "{items}",
      pluralCount(ctx.t.items, minimum.quantity, ctx.locale),
    );
  }
  return null;
}

/** The list's one line under the title. */
export function listSummary(src: DiscountSummarySource, ctx: SummaryContext): string {
  return [valueLine(src, ctx), minimumLine(src, ctx)]
    .filter((line): line is string => line !== null)
    .join(" • ");
}

function combinesLine(combinesWith: CombinesWith, ctx: SummaryContext): string {
  const names = (["product", "order", "shipping"] as const)
    .filter((key) => combinesWith[key])
    .map((key) => ctx.t.combinesNames[key]);
  if (names.length === 0) return ctx.t.combinesNone;
  return ctx.t.combinesWith.replace(
    "{classes}",
    new Intl.ListFormat(ctx.locale, { type: "conjunction" }).format(names),
  );
}

function activeLine(src: DiscountSummarySource, ctx: SummaryContext): string | null {
  if (Number.isNaN(Date.parse(src.startsAt))) return null;
  const start = formatZonedDate(src.startsAt, ctx.locale, ctx.timeZone);
  if (src.endsAt == null || Number.isNaN(Date.parse(src.endsAt))) {
    return ctx.t.activeFrom.replace("{date}", start);
  }
  return ctx.t.activeFromUntil
    .replace("{start}", start)
    .replace("{end}", formatZonedDate(src.endsAt, ctx.locale, ctx.timeZone));
}

/** The Summary card's details, in the form's order. */
export function discountSummary(src: DiscountSummarySource, ctx: SummaryContext): string[] {
  const { t } = ctx;
  const lines: (string | null)[] = [valueLine(src, ctx)];
  if (
    src.type === "amount_off_products" &&
    src.appliesOncePerOrder === true &&
    src.value?.kind === "fixed_amount"
  ) {
    lines.push(t.oncePerOrder);
  }
  if (src.type === "buy_x_get_y" && src.maxUsesPerOrder != null) {
    lines.push(pluralCount(t.maxUsesPerOrder, src.maxUsesPerOrder, ctx.locale));
  }
  if (src.type === "free_shipping" && src.maxShippingRateMinor != null) {
    lines.push(
      t.ratesUnder.replace(
        "{amount}",
        formatCurrency(ctx.locale, src.maxShippingRateMinor, ctx.currency),
      ),
    );
  }
  if (src.type !== "buy_x_get_y") lines.push(minimumLine(src, ctx) ?? t.noMinimum);
  lines.push(src.customerEligibility.kind === "all" ? t.allCustomers : t.someCustomers);
  if (src.usageLimit != null) {
    lines.push(pluralCount(t.usageLimit, src.usageLimit, ctx.locale));
  }
  if (src.oncePerCustomer) lines.push(t.oncePerCustomer);
  lines.push(combinesLine(src.combinesWith, ctx));
  lines.push(activeLine(src, ctx));
  return lines.filter((line): line is string => line !== null);
}

/** The list's Combinations column: "Product, Shipping" or "Not combinable". */
export function combinationsShort(
  combinesWith: CombinesWith,
  t: Pick<Dictionary["discounts"], "combinesShort" | "combinesNone">,
): string {
  const names = (["product", "order", "shipping"] as const)
    .filter((key) => combinesWith[key])
    .map((key) => t.combinesShort[key]);
  return names.length === 0 ? t.combinesNone : names.join(", ");
}
