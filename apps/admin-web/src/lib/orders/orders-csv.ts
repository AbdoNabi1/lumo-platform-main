import { provinceName } from "@platform/regions";
import type { OrderExportLineDto, OrderExportRowDto } from "@/lib/api/orders";
import type { Locale } from "@/lib/i18n";
import { paymentMethodLabel } from "@/lib/payment-method-label";
import { currencyExponent } from "@/lib/products/money";
import type { Dictionary } from "@/messages/en";
import { zonedDateTimeLabel } from "./zoned-time";

/** The CSV's columns, in the spec's order (§1.5). */
export const ORDERS_CSV_COLUMNS = [
  "order",
  "date",
  "customerName",
  "phone",
  "email",
  "line1",
  "line2",
  "city",
  "province",
  "country",
  "items",
  "itemCount",
  "subtotal",
  "shipping",
  "discount",
  "total",
  "codAmount",
  "currency",
  "paymentStatus",
  "paymentMethod",
  "fulfillmentStatus",
  "shippingMethod",
  "tags",
  "notes",
] as const;

const BOM = "\uFEFF";
const CRLF = "\r\n";
/** A `+`/`-` cell that is entirely phone/number-shaped is data, not a formula. */
const PHONE_OR_NUMBER = /^[+-][\d\s().-]*$/;

/**
 * Formula-injection guard (spec decision 13, tightened): a cell Excel would evaluate gets a leading
 * apostrophe. `=`, `@`, tab and carriage return always; `+`/`-` unless the whole cell is phone/number-
 * shaped — so `+201012345678` reaches the courier portal as typed while `+20=cmd|…` is guarded.
 */
export function guardCell(value: string): string {
  const first = value.charAt(0);
  if (first === "=" || first === "@" || first === "\t" || first === "\r") return `'${value}`;
  if ((first === "+" || first === "-") && !PHONE_OR_NUMBER.test(value)) return `'${value}`;
  return value;
}

/** RFC 4180: guarded, then quoted when it holds a comma, quote or line break (quotes doubled). */
export function csvCell(value: string): string {
  const guarded = guardCell(value);
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Minor units as a plain decimal in the currency's exponent: 125000 EGP → "1250.00" (no grouping, no symbol). */
export function plainAmount(amountMinor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  const sign = amountMinor < 0 ? "-" : "";
  const digits = String(Math.abs(amountMinor));
  if (exponent === 0) return `${sign}${digits}`;
  const padded = digits.padStart(exponent + 1, "0");
  return `${sign}${padded.slice(0, -exponent)}.${padded.slice(-exponent)}`;
}

/** `2 × T-shirt (L) [SKU-1]; 1 × Cap`. */
export function itemsCell(items: readonly OrderExportLineDto[]): string {
  return items
    .map(
      (item) =>
        `${item.quantity} × ${item.title}` +
        (item.variantTitle !== null ? ` (${item.variantTitle})` : "") +
        (item.sku !== null ? ` [${item.sku}]` : ""),
    )
    .join("; ");
}

function label(table: unknown, key: string): string {
  return (table as Record<string, string>)[key] ?? key;
}

/** The whole file: BOM, header row in the admin's language, one row per order, CRLF line ends. */
export function buildOrdersCsv(
  rows: readonly OrderExportRowDto[],
  options: { readonly t: Dictionary; readonly locale: Locale; readonly timeZone: string },
): string {
  const { t, locale, timeZone } = options;
  const header = ORDERS_CSV_COLUMNS.map((column) => csvCell(t.ordersExport.columns[column])).join(
    ",",
  );
  const body = rows.map((row) =>
    [
      `#${row.orderNumber}`,
      zonedDateTimeLabel(row.createdAt, timeZone),
      row.customerName ?? "",
      row.phone ?? "",
      row.email ?? "",
      row.line1,
      row.line2 ?? "",
      row.city,
      row.province === null ? "" : provinceName(row.province, locale),
      row.country,
      itemsCell(row.items),
      String(row.itemCount),
      plainAmount(row.subtotalMinor, row.currency),
      plainAmount(row.shippingMinor, row.currency),
      plainAmount(row.discountMinor, row.currency),
      plainAmount(row.totalMinor, row.currency),
      plainAmount(row.codAmountMinor, row.currency),
      row.currency,
      label(t.orderPaymentStatus, row.paymentStatus),
      row.paymentProvider === null ? "" : paymentMethodLabel(row.paymentProvider, t),
      label(t.orderFulfillmentStatus, row.fulfillmentStatus),
      row.shippingMethod === null ? "" : label(t.shippingMethodLabel, row.shippingMethod),
      row.tags.join(", "),
      row.note ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return BOM + [header, ...body].join(CRLF) + CRLF;
}
