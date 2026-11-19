import type { CheckoutLink } from "@platform/checkout";
import {
  draftAmounts,
  draftRequirements,
  type DraftAddress,
  type DraftOrder,
  type DraftOrderStatus,
  type DraftRequirement,
} from "@platform/orders";
import { lineKey } from "./product-images";

/**
 * Order operations Part 4 — what the admin API says about a draft. Every route maps a `DraftOrder`
 * through here: the class itself is never serialized (its JSON is `{ props, persisted }`), and a
 * `CheckoutLink` is reduced to its dates and claim count (never its `tokenHash`).
 */
export type DraftRequirementDto = DraftRequirement;

export interface DraftAddressDto {
  readonly name: string | null;
  readonly phone: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly province: string | null;
  readonly postalCode: string;
  readonly country: string;
}

export interface DraftLineDto {
  readonly productId: string;
  readonly variantId: string;
  readonly sku: string;
  readonly title: string;
  readonly variantTitle: string | null;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  readonly imageUrl: string | null;
}

export interface DraftTotalsDto {
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly shippingMinor: number;
  /** Estimated by Finance for the shipping address; null without one ("Calculated after an address is added"). */
  readonly taxMinor: number | null;
  readonly taxIncluded: boolean;
  readonly totalMinor: number;
}

export interface DraftLinkDto {
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly claimCount: number;
  readonly lastClaimedAt: string | null;
}

export interface DraftOrderDto {
  readonly id: string;
  readonly draftNumber: string;
  readonly status: DraftOrderStatus;
  /** Send it back with a PUT (optimistic lock). */
  readonly version: number;
  readonly currency: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly invoiceSentAt: string | null;
  readonly completedAt: string | null;
  readonly customer: {
    readonly id: string;
    readonly name: string | null;
    readonly email: string | null;
  } | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly shippingAddress: DraftAddressDto | null;
  /** null = same as shipping. */
  readonly billingAddress: DraftAddressDto | null;
  readonly lines: readonly DraftLineDto[];
  readonly discount: {
    readonly valueType: "fixed" | "percentage";
    readonly value: number;
    readonly reason: string | null;
    readonly amountMinor: number;
  } | null;
  readonly shipping: {
    readonly kind: "rate" | "custom" | "free";
    readonly method: string | null;
    readonly title: string;
    readonly amountMinor: number;
  } | null;
  readonly note: string | null;
  readonly tags: readonly string[];
  readonly totals: DraftTotalsDto;
  /** The order it became (completed drafts). */
  readonly order: { readonly id: string; readonly orderNumber: string | null } | null;
  /** Its invoice links, newest first. */
  readonly links: readonly DraftLinkDto[];
  /** What it still needs before Send invoice / Collect payment (spec §4.5). */
  readonly missing: {
    readonly invoice: readonly DraftRequirementDto[];
    readonly complete: readonly DraftRequirementDto[];
  };
}

export interface DraftOrderListItemDto {
  readonly id: string;
  readonly draftNumber: string;
  readonly createdAt: string;
  readonly customerName: string | null;
  readonly status: DraftOrderStatus;
  /** Before tax (Ruling 14). */
  readonly totalMinor: number;
  readonly currency: string;
  readonly orderRef: string | null;
  readonly orderNumber: string | null;
}

const addressDto = (address: DraftAddress | null): DraftAddressDto | null =>
  address === null
    ? null
    : {
        name: address.name,
        phone: address.phone,
        line1: address.line1,
        line2: address.line2,
        city: address.city,
        province: address.province,
        postalCode: address.postalCode,
        country: address.country,
      };

export function draftTotalsOf(
  draft: DraftOrder,
  tax: { readonly taxMinor: number; readonly included: boolean } | null,
): DraftTotalsDto {
  const amounts = draftAmounts(draft);
  return {
    subtotalMinor: amounts.subtotalMinor,
    discountMinor: amounts.discountMinor,
    shippingMinor: amounts.shippingMinor,
    taxMinor: tax?.taxMinor ?? null,
    taxIncluded: tax?.included ?? false,
    totalMinor: amounts.totalBeforeTaxMinor + (tax === null || tax.included ? 0 : tax.taxMinor),
  };
}

/** A link as the draft page shows it: dates and claims only — never the token or its hash. */
export function toDraftLinkDto(link: CheckoutLink): DraftLinkDto {
  return {
    issuedAt: link.createdAt.toISOString(),
    expiresAt: link.expiresAt.toISOString(),
    claimCount: link.claimCount,
    lastClaimedAt: link.lastClaimedAt?.toISOString() ?? null,
  };
}

export interface DraftDetailExtras {
  readonly images: ReadonlyMap<string, { readonly url: string } | null>;
  readonly customer: {
    readonly id: string;
    readonly name: string | null;
    readonly email: string | null;
  } | null;
  readonly tax: { readonly taxMinor: number; readonly included: boolean } | null;
  readonly orderNumber: string | null;
  readonly links: readonly CheckoutLink[];
}

export function toDraftOrderDto(draft: DraftOrder, extras: DraftDetailExtras): DraftOrderDto {
  const amounts = draftAmounts(draft);
  const content = draft.content();
  return {
    id: draft.id,
    draftNumber: draft.draftNumber,
    status: draft.status,
    version: draft.version,
    currency: draft.currency,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
    invoiceSentAt: draft.invoiceSentAt?.toISOString() ?? null,
    completedAt: draft.completedAt?.toISOString() ?? null,
    customer: extras.customer,
    email: draft.contactEmail,
    phone: draft.contactPhone,
    shippingAddress: addressDto(draft.shippingAddress),
    billingAddress: addressDto(draft.billingAddress),
    lines: draft.lines.map((line) => ({
      productId: line.productRef,
      variantId: line.variantRef,
      sku: line.sku,
      title: line.title,
      variantTitle: line.variantTitle,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      lineTotalMinor: line.unitPriceMinor * line.quantity,
      imageUrl: extras.images.get(lineKey(line.productRef, line.variantRef))?.url ?? null,
    })),
    discount:
      draft.discount === null
        ? null
        : {
            valueType: draft.discount.valueType,
            value: draft.discount.value,
            reason: draft.discount.reason,
            amountMinor: amounts.discountMinor,
          },
    shipping:
      draft.shipping === null
        ? null
        : {
            kind: draft.shipping.kind,
            method: draft.shipping.kind === "rate" ? draft.shipping.method : null,
            title: draft.shipping.title,
            amountMinor: draft.shipping.amountMinor,
          },
    note: draft.note,
    tags: [...draft.tags],
    totals: draftTotalsOf(draft, extras.tax),
    order: draft.orderRef === null ? null : { id: draft.orderRef, orderNumber: extras.orderNumber },
    links: extras.links.map(toDraftLinkDto),
    missing: {
      invoice: draftRequirements(content, "invoice"),
      complete: draftRequirements(content, "complete"),
    },
  };
}

export function toDraftListItemDto(
  draft: DraftOrder,
  extras: { readonly customerName: string | null; readonly orderNumber: string | null },
): DraftOrderListItemDto {
  return {
    id: draft.id,
    draftNumber: draft.draftNumber,
    createdAt: draft.createdAt.toISOString(),
    customerName: extras.customerName,
    status: draft.status,
    totalMinor: draftAmounts(draft).totalBeforeTaxMinor,
    currency: draft.currency,
    orderRef: draft.orderRef,
    orderNumber: extras.orderNumber,
  };
}
