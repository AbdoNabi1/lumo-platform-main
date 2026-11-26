import type { TemplateLocale, TemplateVariable } from "./template-catalogue";

/**
 * Wave 2b (D39): renders a merchant template. Pure: no I/O, no clock.
 *
 * - `{{name}}` is replaced by its value; EVERY value is HTML-escaped in the HTML part. The template's
 *   own text is escaped too (a merchant body is plain text, never HTML) and newlines become `<br>`.
 * - A name the template's catalogue entry does not list renders as nothing and is reported in
 *   `unknownVariables` (the preview shows it); a listed name with no value also renders as nothing.
 * - `{{line_items}}` and `{{order_totals}}` are blocks the code builds from structured order data.
 * - The subject is plain text: values are inserted raw, with control characters (so a CR/LF can never
 *   start a new header) removed and whitespace collapsed.
 * - A `url` variable becomes a link only for http(s); anything else stays inert text.
 */

export interface OrderLineData {
  readonly name: string;
  readonly variantTitle?: string | null;
  readonly quantity: number;
  readonly unitAmountMinor: number;
}

export interface OrderBlockData {
  readonly currency: string;
  readonly lines: readonly OrderLineData[];
  readonly subtotalMinor?: number;
  readonly discountMinor?: number;
  readonly shippingMinor?: number;
  readonly taxMinor?: number;
  readonly totalMinor?: number;
}

export interface RenderInput {
  readonly subject: string;
  readonly body: string;
  readonly locale: TemplateLocale;
  readonly storeName: string;
  readonly variables: Readonly<Record<string, string>>;
  readonly catalogueVariables: readonly TemplateVariable[];
  readonly order?: OrderBlockData;
}

export interface RenderedMail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly unknownVariables: readonly string[];
}

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F\u2028\u2029]/g;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripControl(value: string): string {
  return value.replace(CONTROL, "");
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** The currency's minor-unit digits (EGP 2, JPY 0, KWD 3), from the platform's own Intl data. */
function fractionDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

export function formatMoney(amountMinor: number, currency: string, locale: TemplateLocale): string {
  const digits = fractionDigits(currency);
  const major = amountMinor / 10 ** digits;
  try {
    return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en", {
      style: "currency",
      currency,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(digits)}`;
  }
}

const LABELS: Readonly<
  Record<
    TemplateLocale,
    {
      subtotal: string;
      discount: string;
      shipping: string;
      tax: string;
      total: string;
      qty: string;
    }
  >
> = {
  en: {
    subtotal: "Subtotal",
    discount: "Discount",
    shipping: "Shipping",
    tax: "Taxes",
    total: "Total",
    qty: "Qty",
  },
  ar: {
    subtotal: "المجموع الفرعي",
    discount: "الخصم",
    shipping: "الشحن",
    tax: "الضرائب",
    total: "الإجمالي",
    qty: "الكمية",
  },
};

interface Block {
  readonly html: string;
  readonly text: string;
}

function lineItemsBlock(order: OrderBlockData, locale: TemplateLocale): Block {
  if (order.lines.length === 0) return { html: "", text: "" };
  const rows = order.lines.map((line) => {
    const title = line.variantTitle ? `${line.name} (${line.variantTitle})` : line.name;
    const price = formatMoney(line.unitAmountMinor * line.quantity, order.currency, locale);
    return { title, quantity: line.quantity, price };
  });
  const html =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' +
    rows
      .map(
        (row) =>
          `<tr><td style="padding:6px 0;border-bottom:1px solid #e5e5e5">${escapeHtml(row.title)}` +
          ` &times; ${row.quantity}</td>` +
          `<td style="padding:6px 0;border-bottom:1px solid #e5e5e5;text-align:end">${escapeHtml(row.price)}</td></tr>`,
      )
      .join("") +
    "</table>";
  const text = rows.map((row) => `${row.title} x ${row.quantity}  ${row.price}`).join("\n");
  return { html, text };
}

function totalsBlock(order: OrderBlockData, locale: TemplateLocale): Block {
  const labels = LABELS[locale];
  const entries: { label: string; value: string; strong: boolean }[] = [];
  const add = (label: string, amount: number | undefined, strong = false) => {
    if (amount === undefined) return;
    entries.push({ label, value: formatMoney(amount, order.currency, locale), strong });
  };
  add(labels.subtotal, order.subtotalMinor);
  if (order.discountMinor !== undefined && order.discountMinor > 0) {
    add(labels.discount, -order.discountMinor);
  }
  add(labels.shipping, order.shippingMinor);
  add(labels.tax, order.taxMinor);
  add(labels.total, order.totalMinor, true);
  if (entries.length === 0) return { html: "", text: "" };
  const html =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' +
    entries
      .map((entry) => {
        const weight = entry.strong ? "font-weight:bold;" : "";
        return (
          `<tr><td style="padding:4px 0;${weight}">${escapeHtml(entry.label)}</td>` +
          `<td style="padding:4px 0;text-align:end;${weight}">${escapeHtml(entry.value)}</td></tr>`
        );
      })
      .join("") +
    "</table>";
  const text = entries.map((entry) => `${entry.label}: ${entry.value}`).join("\n");
  return { html, text };
}

function substituteLine(pattern: string, resolve: (name: string) => string): string {
  return pattern.replace(PLACEHOLDER, (_match, name: string) => resolve(name));
}

export function renderTemplate(input: RenderInput): RenderedMail {
  const known = new Map(input.catalogueVariables.map((variable) => [variable.name, variable]));
  const unknown = new Set<string>();
  const note = (name: string): TemplateVariable | undefined => {
    const variable = known.get(name);
    if (variable === undefined) unknown.add(name);
    return variable;
  };
  const blocks: Record<string, Block> =
    input.order === undefined
      ? {}
      : {
          line_items: lineItemsBlock(input.order, input.locale),
          order_totals: totalsBlock(input.order, input.locale),
        };

  // Subject: plain text, no block, no control characters.
  const subject = stripControl(
    substituteLine(input.subject, (name) => {
      const variable = note(name);
      if (variable === undefined || variable.kind === "block") return "";
      return input.variables[name] ?? "";
    }),
  )
    .replace(/\s+/g, " ")
    .trim();

  let html = "";
  let text = "";
  let last = 0;
  const body = input.body.replace(/\r\n?/g, "\n");
  const appendText = (segment: string): void => {
    html += escapeHtml(segment).replace(/\n/g, "<br>");
    text += segment;
  };
  for (const match of body.matchAll(PLACEHOLDER)) {
    const name = match[1] ?? "";
    appendText(body.slice(last, match.index));
    last = (match.index ?? 0) + match[0].length;
    const variable = note(name);
    if (variable === undefined) continue;
    if (variable.kind === "block") {
      const block = blocks[name];
      if (block !== undefined) {
        html += block.html;
        text += block.text;
      }
      continue;
    }
    const value = stripControl(input.variables[name] ?? "");
    if (value === "") continue;
    if (variable.kind === "url" && isHttpUrl(value)) {
      html += `<a href="${escapeHtml(value)}">${escapeHtml(value)}</a>`;
    } else {
      html += escapeHtml(value);
    }
    text += value;
  }
  appendText(body.slice(last));

  const dir = input.locale === "ar" ? "rtl" : "ltr";
  const document =
    `<!doctype html><html lang="${input.locale}" dir="${dir}"><head><meta charset="utf-8"></head>` +
    `<body style="margin:0;padding:24px;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif;color:#222">` +
    `<div style="max-width:600px;margin:0 auto;background:#ffffff;padding:24px;line-height:1.5">` +
    `<p style="margin:0 0 16px;font-size:18px;font-weight:bold">${escapeHtml(input.storeName)}</p>` +
    `<div>${html}</div></div></body></html>`;

  return {
    subject,
    html: document,
    text: text.trim(),
    unknownVariables: [...unknown],
  };
}
