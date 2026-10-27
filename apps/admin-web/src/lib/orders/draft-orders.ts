import type { FieldIssue } from "@/lib/api/client";
import type {
  DraftAddressInput,
  DraftOrderDto,
  DraftOrderInput,
  DraftOrderStatus,
} from "@/lib/api/draft-orders";
import { fillTemplate } from "@/lib/whatsapp";

/** The bound on a merchant-entered amount (custom shipping, fixed discount): `MAX_DRAFT_AMOUNT_MINOR`. */
export const MAX_DRAFT_AMOUNT_MINOR = 10_000_000;

/** Shopify's page size; the API's maximum too. */
export const DRAFT_PAGE_SIZE = 50;
export const DRAFT_STATUSES: readonly DraftOrderStatus[] = ["open", "invoice_sent", "completed"];

export function parseDraftStatus(raw: string | undefined): DraftOrderStatus | undefined {
  return DRAFT_STATUSES.find((status) => status === raw);
}

/** The API's own limits on the list query (`draft-order-routes.ts` `listQuery`). */
const DRAFT_SEARCH_MAX = 200;
const DRAFT_CURSOR_MAX = 64;

/**
 * The Drafts list's URL, read defensively: Next hands a repeated parameter over as an array, and a
 * hand-edited URL can carry more than the API accepts. A repeated `q` keeps its first value and an
 * over-long one is cut to the API's 200; a cursor that is repeated or too long is dropped (page
 * one), as is an unknown or repeated status — never an error panel.
 */
export function draftListParams(raw: {
  readonly status?: string | readonly string[] | undefined;
  readonly q?: string | readonly string[] | undefined;
  readonly after?: string | readonly string[] | undefined;
}): {
  readonly status: DraftOrderStatus | undefined;
  readonly q: string | undefined;
  readonly after: string | undefined;
} {
  const rawQ = typeof raw.q === "string" ? raw.q : raw.q?.[0];
  const q = rawQ?.trim().slice(0, DRAFT_SEARCH_MAX) || undefined;
  const after =
    typeof raw.after === "string" && raw.after !== "" && raw.after.length <= DRAFT_CURSOR_MAX
      ? raw.after
      : undefined;
  const status = parseDraftStatus(typeof raw.status === "string" ? raw.status : undefined);
  return { status, q, after };
}

/** A tab's link: the search stays, the cursor goes (a new tab starts on page one). */
export function draftsHref(state: {
  readonly status: DraftOrderStatus | undefined;
  readonly q: string | undefined;
}): string {
  const params = new URLSearchParams();
  if (state.status !== undefined) params.set("status", state.status);
  if (state.q !== undefined && state.q !== "") params.set("q", state.q);
  const query = params.toString();
  return query === "" ? "/draft-orders" : `/draft-orders?${query}`;
}

/** `orders:draft` / `orders:complete_draft` are operators' and admins' (the API decides; this only hides buttons). */
export function canEditDrafts(role: string | undefined): boolean {
  return role === "admin" || role === "operator";
}

/** "Mark as paid" also needs `payments:confirm_cod_collection` — admins only (spec Permissions). */
export function canMarkDraftPaid(role: string | undefined): boolean {
  return role === "admin";
}

/** Ruling 19: the API prefixes every draft 409 message with its code. */
export function conflictCodeOf(message: string): string | null {
  return /^([A-Z_]+):/.exec(message)?.[1] ?? null;
}

/** Every address field as the form edits it (strings; blank = absent). */
export interface DraftFormAddress {
  readonly name: string;
  readonly phone: string;
  readonly line1: string;
  readonly line2: string;
  readonly city: string;
  readonly province: string;
  readonly postalCode: string;
  readonly country: string;
}

/** A line as the editor shows it; only `productId`, `variantId` and `quantity` are ever sent. */
export interface DraftFormLine {
  readonly productId: string;
  readonly variantId: string | null;
  readonly quantity: number;
  readonly title: string;
  readonly variantTitle: string | null;
  readonly sku: string | null;
  readonly imageUrl: string | null;
  /** For display until the server prices it on save (Ruling 12). */
  readonly unitPriceMinor: number | null;
}

export type DraftFormShipping =
  | {
      readonly kind: "rate";
      readonly method: string;
      readonly title: string;
      readonly amountMinor: number;
    }
  | { readonly kind: "custom"; readonly title: string; readonly amountMinor: number }
  | { readonly kind: "free" }
  | null;

export interface DraftForm {
  readonly customer: {
    readonly id: string;
    readonly name: string | null;
    readonly email: string | null;
  } | null;
  readonly email: string;
  readonly phone: string;
  readonly shippingAddress: DraftFormAddress | null;
  readonly billingSame: boolean;
  readonly billingAddress: DraftFormAddress | null;
  readonly lines: readonly DraftFormLine[];
  readonly discount: {
    readonly valueType: "fixed" | "percentage";
    readonly value: number;
    readonly reason: string;
  } | null;
  readonly shipping: DraftFormShipping;
  readonly note: string;
  readonly tags: readonly string[];
}

/** Egypt first: the platform's home market. */
export const EMPTY_DRAFT_ADDRESS: DraftFormAddress = {
  name: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  province: "",
  postalCode: "",
  country: "EG",
};

const formAddress = (a: DraftOrderDto["shippingAddress"]): DraftFormAddress | null =>
  a === null
    ? null
    : {
        name: a.name ?? "",
        phone: a.phone ?? "",
        line1: a.line1,
        line2: a.line2 ?? "",
        city: a.city,
        province: a.province ?? "",
        postalCode: a.postalCode,
        country: a.country,
      };

export function formFromDraft(draft: DraftOrderDto | null): DraftForm {
  if (draft === null) {
    return {
      customer: null,
      email: "",
      phone: "",
      shippingAddress: null,
      billingSame: true,
      billingAddress: null,
      lines: [],
      discount: null,
      shipping: null,
      note: "",
      tags: [],
    };
  }
  return {
    customer: draft.customer,
    email: draft.email ?? "",
    phone: draft.phone ?? "",
    shippingAddress: formAddress(draft.shippingAddress),
    billingSame: draft.billingAddress === null,
    billingAddress: formAddress(draft.billingAddress),
    lines: draft.lines.map((l) => ({
      productId: l.productId,
      variantId: l.variantId,
      quantity: l.quantity,
      title: l.title,
      variantTitle: l.variantTitle,
      sku: l.sku,
      imageUrl: l.imageUrl,
      unitPriceMinor: l.unitPriceMinor,
    })),
    discount:
      draft.discount === null
        ? null
        : {
            valueType: draft.discount.valueType,
            value: draft.discount.value,
            reason: draft.discount.reason ?? "",
          },
    shipping:
      draft.shipping === null
        ? null
        : draft.shipping.kind === "rate"
          ? {
              kind: "rate",
              method: draft.shipping.method ?? "",
              title: draft.shipping.title,
              amountMinor: draft.shipping.amountMinor,
            }
          : draft.shipping.kind === "custom"
            ? {
                kind: "custom",
                title: draft.shipping.title,
                amountMinor: draft.shipping.amountMinor,
              }
            : { kind: "free" },
    note: draft.note ?? "",
    tags: [...draft.tags],
  };
}

function addressInput(a: DraftFormAddress | null): DraftAddressInput | null {
  if (a === null) return null;
  const optional = (key: "name" | "phone" | "line2" | "province", value: string) =>
    value.trim() === "" ? {} : { [key]: value.trim() };
  return {
    ...optional("name", a.name),
    ...optional("phone", a.phone),
    line1: a.line1.trim(),
    ...optional("line2", a.line2),
    city: a.city.trim(),
    ...optional("province", a.province),
    postalCode: a.postalCode.trim(),
    country: a.country,
  };
}

/** The API input: ids, quantities and the merchant's own terms — never a line price (binding carry 9). */
export function inputFromForm(form: DraftForm, defaultDiscountReason: string): DraftOrderInput {
  const blank = (v: string) => (v.trim() === "" ? null : v.trim());
  return {
    customerId: form.customer?.id ?? null,
    email: blank(form.email),
    phone: blank(form.phone),
    shippingAddress: addressInput(form.shippingAddress),
    billingAddress: form.billingSame ? null : addressInput(form.billingAddress),
    lines: form.lines.map((l) => ({
      productId: l.productId,
      ...(l.variantId === null ? {} : { variantId: l.variantId }),
      quantity: l.quantity,
    })),
    discount:
      form.discount === null
        ? null
        : {
            valueType: form.discount.valueType,
            value: form.discount.value,
            reason:
              form.discount.reason.trim() === ""
                ? defaultDiscountReason
                : form.discount.reason.trim(),
          },
    shipping:
      form.shipping === null
        ? null
        : form.shipping.kind === "rate"
          ? { kind: "rate", method: form.shipping.method }
          : form.shipping.kind === "custom"
            ? { kind: "custom", title: form.shipping.title, amountMinor: form.shipping.amountMinor }
            : { kind: "free" },
    note: blank(form.note),
    tags: [...form.tags],
  };
}

/** Two forms are the same when they would send the same input (display fields do not count). */
export function sameDraftForm(a: DraftForm, b: DraftForm): boolean {
  return JSON.stringify(inputFromForm(a, "")) === JSON.stringify(inputFromForm(b, ""));
}

/**
 * Review Focus 5: the draft's phone, else the shipping phone — with the shipping country, which
 * `toWhatsAppDigits` needs to read a national number. Null phone → WhatsApp's chat picker.
 */
export function draftWhatsAppTarget(form: Pick<DraftForm, "phone" | "shippingAddress">): {
  readonly phone: string | null;
  readonly country: string | null;
} {
  const country = form.shippingAddress?.country ?? null;
  if (form.phone.trim() !== "") return { phone: form.phone.trim(), country };
  const shipping = form.shippingAddress?.phone.trim() ?? "";
  return shipping === "" ? { phone: null, country: null } : { phone: shipping, country };
}

/** The Send invoice WhatsApp text; values go in literally (`$&` stays as typed). */
export function invoiceMessage(
  template: string,
  values: {
    readonly name: string;
    readonly draft: string;
    readonly shop: string;
    readonly total: string;
    readonly url: string;
  },
): string {
  return fillTemplate(template, values);
}

export function fieldErrorsOf(fields: readonly FieldIssue[]): Readonly<Record<string, string>> {
  return Object.fromEntries(fields.map((f) => [f.field, f.message]));
}
