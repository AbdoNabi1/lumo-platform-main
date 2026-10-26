import { z } from "zod";
import type { Principal } from "@platform/contracts";
import { checkoutAddressProblem, type CheckoutController } from "@platform/checkout";
import type { CustomerContact } from "@platform/identity";
import {
  draftAmounts,
  MAX_DRAFT_AMOUNT_MINOR,
  MAX_DRAFT_LINE_QUANTITY,
  MAX_DRAFT_LINES,
  type DraftAddress,
  type DraftLine,
  type DraftOrder,
  type DraftOrderContent,
  type DraftShipping,
} from "@platform/orders";
import {
  BusinessRuleError,
  toErrorEnvelope,
  ValidationError,
  type FieldIssue,
} from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import { resolveMerchandise } from "./merchandise-resolution";

const amount = z.number().int().min(0).max(MAX_DRAFT_AMOUNT_MINOR);

export const addressBody = z
  .object({
    name: z.string().max(120).optional(),
    phone: z.string().max(32).optional(),
    line1: z.string().min(1).max(200),
    line2: z.string().max(200).optional(),
    city: z.string().min(1).max(100),
    province: z.string().max(10).optional(),
    postalCode: z.string().max(20).optional(),
    country: z.string().length(2),
  })
  .strict();

/**
 * Spec §4.8 `DraftOrderInput`, `.strict()`: the browser sends ids, quantities and the merchant's own
 * terms — NEVER a line price (binding carry 9). The two merchant amounts are bounded here and again in
 * the domain.
 */
export const draftBody = z
  .object({
    customerId: z.string().min(1).max(64).nullable().optional(),
    email: z.string().max(254).nullable().optional(),
    phone: z.string().max(32).nullable().optional(),
    shippingAddress: addressBody.nullable().optional(),
    billingAddress: addressBody.nullable().optional(),
    lines: z
      .array(
        z
          .object({
            productId: z.string().min(1).max(64),
            variantId: z.string().min(1).max(64).optional(),
            quantity: z.number().int().min(1).max(MAX_DRAFT_LINE_QUANTITY),
          })
          .strict(),
      )
      .max(MAX_DRAFT_LINES),
    discount: z
      .object({
        valueType: z.enum(["fixed", "percentage"]),
        value: amount,
        reason: z.string().max(255).optional(),
      })
      .strict()
      .refine((d) => d.valueType === "fixed" || d.value <= 100, {
        message: "a percentage is 0-100",
        path: ["value"],
      })
      .nullable()
      .optional(),
    shipping: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("rate"), method: z.string().min(1).max(100) }).strict(),
        z
          .object({
            kind: z.literal("custom"),
            title: z.string().min(1).max(100),
            amountMinor: amount,
          })
          .strict(),
        z.object({ kind: z.literal("free") }).strict(),
      ])
      .nullable()
      .optional(),
    note: z.string().max(5000).nullable().optional(),
    tags: z.array(z.string().max(40)).max(250).optional(),
  })
  .strict();
export type DraftBody = z.infer<typeof draftBody>;

type DraftItems = Parameters<CheckoutController["loadItems"]>[0]["items"];

/** One of the shop's shipping rates for a draft, as the admin API answers it. */
export interface DraftRateQuote {
  readonly method: string;
  readonly title: string;
  readonly amountMinor: number;
}

export function invalidResponse(message: string, fields: readonly FieldIssue[]): AdminResponse {
  return { status: 422, body: toErrorEnvelope(new ValidationError(message, [...fields])) };
}

/**
 * Ruling 19: a 409 whose message starts with `CODE:` also carries that `code` — `VERSION_CONFLICT`,
 * `DRAFT_COMPLETED`, `DRAFT_TOTAL_TOO_LARGE`, … each keep their own, never relabelled. A 409 without a
 * prefix keeps the envelope's own `code`.
 */
export function withConflictCode(response: AdminResponse): AdminResponse {
  if (response.status !== 409) return response;
  const body = response.body as { readonly message?: unknown } | null;
  const match = typeof body?.message === "string" ? /^([A-Z_]+):/.exec(body.message) : null;
  return match === null ? response : { status: 409, body: { ...(body as object), code: match[1] } };
}

export function draftConflict(code: string, message: string): AdminResponse {
  return {
    status: 409,
    body: { ...toErrorEnvelope(new BusinessRuleError(`${code}: ${message}`)), code },
  };
}

/** The shop's currency (Settings → General) — every draft is in it. Null when unreadable. */
export async function storeCurrencyOf(admin: Pick<WiredAdmin, "tenancy">): Promise<string | null> {
  const response = await admin.tenancy.getPublicStore();
  if (response.status !== 200) return null;
  const currency = (response.body as { readonly currency?: unknown }).currency;
  return typeof currency === "string" ? currency : null;
}

export function checkoutAddressOf(address: DraftAddress) {
  return {
    ...(address.name === null ? {} : { name: address.name }),
    ...(address.phone === null ? {} : { phone: address.phone }),
    line1: address.line1,
    ...(address.line2 === null ? {} : { line2: address.line2 }),
    city: address.city,
    postalCode: address.postalCode,
    country: address.country,
    ...(address.province === null ? {} : { province: address.province }),
  };
}

export function draftItemsOf(lines: readonly DraftLine[], currency: string): DraftItems {
  return lines.map((line) => ({
    productId: line.productRef,
    variantId: line.variantRef,
    sku: line.sku,
    title: line.title,
    variantTitle: line.variantTitle,
    quantity: line.quantity,
    unitPriceAmountMinor: line.unitPriceMinor,
    currency,
  }));
}

/**
 * The shop's shipping rates for an address and priced lines — the SAME quote Checkout gives a shopper
 * (spec §4.3). The one place the admin API asks for them: a `rate` shipping is re-priced from this on
 * every save, and the rates route lists it. Answers the rates, or Checkout's refusal as it was.
 */
export async function draftRateQuotes(
  admin: Pick<WiredAdmin, "publicReads">,
  tenantId: string,
  currency: string,
  address: DraftAddress,
  lines: readonly DraftLine[],
): Promise<
  | { readonly ok: true; readonly rates: readonly DraftRateQuote[] }
  | { readonly ok: false; readonly response: AdminResponse }
> {
  const quoted = await admin.publicReads.checkout.quoteDraftShipping({
    tenantId,
    currency,
    address: {
      country: address.country,
      postalCode: address.postalCode,
      ...(address.province === null ? {} : { province: address.province }),
    },
    items: draftItemsOf(lines, currency),
  });
  if (quoted.status !== 200) return { ok: false, response: quoted };
  const { quotes } = quoted.body as {
    readonly quotes: readonly {
      readonly method: string;
      readonly name: string;
      readonly rateAmountMinor: number;
    }[];
  };
  return {
    ok: true,
    rates: quotes.map((q) => ({ method: q.method, title: q.name, amountMinor: q.rateAmountMinor })),
  };
}

function addressFrom(raw: z.infer<typeof addressBody>): DraftAddress {
  return {
    name: raw.name ?? null,
    phone: raw.phone ?? null,
    line1: raw.line1,
    line2: raw.line2 ?? null,
    city: raw.city,
    province: raw.province ?? null,
    postalCode: raw.postalCode ?? "",
    country: raw.country.toUpperCase(),
  };
}

function addressIssues(prefix: string, address: DraftAddress | null): FieldIssue[] {
  if (address === null) return [];
  const problem = checkoutAddressProblem(checkoutAddressOf(address));
  return problem === null
    ? []
    : problem.fields.map((issue) => ({
        field: `${prefix}.${issue.field}`,
        message: issue.message,
      }));
}

const isBlank = (value: string | null | undefined): boolean =>
  value === null || value === undefined || value.trim().length === 0;

/**
 * Ruling 18: an existing customer must be THIS shop's — Identity's contact read is scoped by the
 * request's tenant, so another shop's customer (or an unknown id) is simply not found. Runs on create
 * AND update: `UpdateDraftOrder` stores whatever `customerRef` it is given.
 */
async function shopCustomerOf(
  admin: Pick<WiredAdmin, "customers">,
  principal: Principal,
  tenantId: string,
  customerId: string,
): Promise<CustomerContact | undefined> {
  const contacts = await admin.customers.contactsOfCustomers(principal, {
    tenantId,
    customerIds: [customerId],
  });
  return contacts.status === 200
    ? (contacts.body as readonly CustomerContact[]).find((c) => c.id === customerId)
    : undefined;
}

/**
 * Turns the merchant's input into draft CONTENT, server-side (spec §4.3, Ruling 12): each line priced
 * from Catalog now; a `rate` shipping re-quoted from the draft's address and lines; addresses checked
 * with Checkout's own rule (province of the country); an existing customer must be this shop's
 * (Ruling 18), and their email fills an empty contact email. Answers the content or the 422 to return.
 */
export async function draftContentFrom(
  admin: WiredAdmin,
  principal: Principal,
  tenantId: string,
  body: DraftBody,
  currency: string,
): Promise<
  | { readonly ok: true; readonly content: DraftOrderContent }
  | { readonly ok: false; readonly response: AdminResponse }
> {
  const issues: FieldIssue[] = [];
  const lines: DraftLine[] = [];
  for (const [index, line] of body.lines.entries()) {
    const priced = await resolveMerchandise(
      admin,
      {
        productId: line.productId,
        ...(line.variantId === undefined ? {} : { variantId: line.variantId }),
      },
      tenantId,
    );
    if (priced.status === "choose_variant") {
      issues.push({ field: `lines.${index}.variantId`, message: "choose a variant" });
    } else if (priced.status !== "ok") {
      issues.push({ field: `lines.${index}`, message: "this product can no longer be sold" });
    } else if (priced.currency !== currency) {
      issues.push({
        field: `lines.${index}`,
        message: `priced in ${priced.currency}, not ${currency}`,
      });
    } else {
      lines.push({
        productRef: priced.productId,
        variantRef: priced.variantId,
        sku: priced.sku,
        title: priced.title,
        variantTitle: priced.variantTitle,
        quantity: line.quantity,
        unitPriceMinor: priced.amountMinor,
      });
    }
  }

  const shippingAddress = body.shippingAddress == null ? null : addressFrom(body.shippingAddress);
  const billingAddress = body.billingAddress == null ? null : addressFrom(body.billingAddress);
  issues.push(
    ...addressIssues("shippingAddress", shippingAddress),
    ...addressIssues("billingAddress", billingAddress),
  );

  let customer: CustomerContact | undefined;
  if (body.customerId != null) {
    customer = await shopCustomerOf(admin, principal, tenantId, body.customerId);
    if (customer === undefined) {
      issues.push({ field: "customerId", message: "no such customer in this shop" });
    }
  }

  let shipping: DraftShipping | null = null;
  const choice = body.shipping ?? null;
  if (choice?.kind === "custom") {
    shipping = { kind: "custom", title: choice.title, amountMinor: choice.amountMinor };
  }
  if (choice?.kind === "free") shipping = { kind: "free", title: "", amountMinor: 0 };
  if (choice?.kind === "rate") {
    if (shippingAddress === null || lines.length === 0) {
      issues.push({ field: "shipping.method", message: "add an address and products first" });
    } else {
      const quoted = await draftRateQuotes(admin, tenantId, currency, shippingAddress, lines);
      const quote = quoted.ok ? quoted.rates.find((q) => q.method === choice.method) : undefined;
      if (quote === undefined) {
        issues.push({
          field: "shipping.method",
          message: "this rate does not apply to the address",
        });
      } else {
        shipping = {
          kind: "rate",
          method: quote.method,
          title: quote.title,
          amountMinor: quote.amountMinor,
        };
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, response: invalidResponse("Invalid draft order", issues) };
  }
  return {
    ok: true,
    content: {
      customerRef: customer?.id ?? null,
      contactEmail: isBlank(body.email) ? (customer?.email ?? null) : (body.email ?? null),
      contactPhone: body.phone ?? null,
      shippingAddress,
      billingAddress,
      lines,
      discount:
        body.discount == null
          ? null
          : {
              valueType: body.discount.valueType,
              value: body.discount.value,
              reason: body.discount.reason ?? null,
            },
      shipping,
      note: body.note ?? null,
      tags: body.tags ?? [],
    },
  };
}

/** Spec §4.3 "Estimated tax": Finance's figure for the draft's address, or null without one. Read-only. */
export async function estimatedTaxOf(
  admin: Pick<WiredAdmin, "publicReads">,
  tenantId: string,
  draft: DraftOrder,
): Promise<{ readonly taxMinor: number; readonly included: boolean } | null> {
  const address = draft.shippingAddress;
  if (address === null || draft.lines.length === 0) return null;
  const amounts = draftAmounts(draft);
  const response = await admin.publicReads.checkout.estimateDraftTax({
    tenantId,
    currency: draft.currency,
    items: draftItemsOf(draft.lines, draft.currency),
    destination: {
      country: address.country,
      ...(address.province === null ? {} : { province: address.province }),
    },
    shippingMinor: amounts.shippingMinor,
    discountMinor: amounts.discountMinor,
  });
  if (response.status !== 200) return null;
  const tax = response.body as { readonly taxMinor: number; readonly included?: boolean };
  return { taxMinor: tax.taxMinor, included: tax.included ?? false };
}
