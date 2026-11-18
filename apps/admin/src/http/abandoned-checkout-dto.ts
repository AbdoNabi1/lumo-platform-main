import type { CheckoutLink, CheckoutSession, CheckoutSessionRecord } from "@platform/checkout";

/**
 * Order operations Part 3 — the staff view of an abandoned checkout (spec §3.6). Domain aggregates
 * never go on the wire; the guest's `sessionRef` (their ownership secret) is never part of it.
 */

export interface RecoveredOrderDto {
  readonly id: string;
  /** Null only if the order could not be read back (it was placed through this shop's checkout). */
  readonly orderNumber: string | null;
}

export interface AbandonedCheckoutListItemDto {
  readonly id: string;
  /** "#" + the id's last 8 hex digits, upper case. */
  readonly reference: string;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly customerName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  /** Province code (ISO 3166-2), else the city. */
  readonly region: string | null;
  /** Shipping country (ISO 3166-1) — WhatsApp sharing needs it for the calling code. */
  readonly country: string | null;
  readonly itemCount: number;
  readonly totalMinor: number;
  readonly currency: string;
  readonly recoveryStatus: "not_recovered" | "recovered";
  readonly recoveredOrder: RecoveredOrderDto | null;
  readonly lastLinkIssuedAt: string | null;
}

export interface AbandonedCheckoutLineDto {
  readonly productId: string;
  readonly variantId: string | null;
  readonly title: string | null;
  readonly variantTitle: string | null;
  readonly sku: string | null;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  /** Filled in by `withLineImages`. */
  readonly imageUrl: string | null;
}

export interface AbandonedCheckoutTotalsDto {
  readonly subtotalMinor: number;
  readonly shippingMinor: number;
  readonly taxMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
  readonly taxIncluded: boolean;
}

export interface AbandonedCheckoutAddressDto {
  readonly name: string | null;
  readonly phone: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly province: string | null;
  readonly postalCode: string;
  readonly country: string;
}

export interface AbandonedCheckoutLinkDto {
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly claimCount: number;
  readonly lastClaimedAt: string | null;
}

export interface AbandonedCheckoutDetailDto extends AbandonedCheckoutListItemDto {
  readonly items: readonly AbandonedCheckoutLineDto[];
  readonly totals: AbandonedCheckoutTotalsDto | null;
  readonly shippingAddress: AbandonedCheckoutAddressDto | null;
  /** Newest first. */
  readonly links: readonly AbandonedCheckoutLinkDto[];
}

/** `POST /abandoned-checkouts/:id/recovery-link` (201). */
export interface RecoveryLinkDto {
  /** `https://<primary verified shop hostname>/c/<token>`, or null when the shop has no domain. */
  readonly url: string | null;
  readonly path: string;
  readonly expiresAt: string;
  /** For the WhatsApp message admin-web composes in the admin's language. */
  readonly shopName: string;
}

export function checkoutReference(id: string): string {
  return `#${id.replace(/-/g, "").slice(-8).toUpperCase()}`;
}

function itemsSubtotal(session: CheckoutSession): number {
  return session.items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
}

export function recoveredOrderOf(
  session: Pick<CheckoutSession, "recoveredOrderRef">,
  orderNumbers: ReadonlyMap<string, string>,
): RecoveredOrderDto | null {
  const orderRef = session.recoveredOrderRef;
  return orderRef === undefined
    ? null
    : { id: orderRef, orderNumber: orderNumbers.get(orderRef) ?? null };
}

export function toAbandonedListItemDto(
  record: CheckoutSessionRecord,
  extra: {
    readonly lastLinkIssuedAt: Date | null;
    readonly recoveredOrder: RecoveredOrderDto | null;
  },
): AbandonedCheckoutListItemDto {
  const { session } = record;
  const address = session.shippingAddress;
  const id = session.id.toString();
  return {
    id,
    reference: checkoutReference(id),
    createdAt: record.createdAt.toISOString(),
    lastActivityAt: record.updatedAt.toISOString(),
    customerName: address?.name ?? null,
    email: session.contactEmail?.value ?? null,
    phone: address?.phone ?? null,
    region: address?.province ?? address?.city ?? null,
    country: address?.country ?? null,
    itemCount: session.items.reduce((count, item) => count + item.quantity, 0),
    totalMinor: session.totals?.totalMinor ?? itemsSubtotal(session),
    currency: session.currency,
    recoveryStatus: session.recoveredOrderRef === undefined ? "not_recovered" : "recovered",
    recoveredOrder: extra.recoveredOrder,
    lastLinkIssuedAt: extra.lastLinkIssuedAt?.toISOString() ?? null,
  };
}

export function toAbandonedDetailDto(
  record: CheckoutSessionRecord,
  links: readonly CheckoutLink[],
  recoveredOrder: RecoveredOrderDto | null,
): AbandonedCheckoutDetailDto {
  const { session } = record;
  const address = session.shippingAddress;
  const totals = session.totals;
  return {
    ...toAbandonedListItemDto(record, {
      lastLinkIssuedAt: links[0]?.createdAt ?? null,
      recoveredOrder,
    }),
    items: session.items.map((item) => ({
      productId: item.productRef,
      variantId: item.variantRef ?? null,
      title: item.title ?? null,
      variantTitle: item.variantTitle ?? null,
      sku: item.sku ?? null,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceAmountMinor,
      lineTotalMinor: item.lineTotalMinor,
      imageUrl: null,
    })),
    totals:
      totals === undefined
        ? null
        : {
            subtotalMinor: totals.subtotalMinor,
            shippingMinor: totals.shippingMinor,
            taxMinor: totals.taxMinor,
            discountMinor: totals.discountMinor,
            totalMinor: totals.totalMinor,
            taxIncluded: totals.taxIncluded,
          },
    shippingAddress:
      address === undefined
        ? null
        : {
            name: address.name ?? null,
            phone: address.phone ?? null,
            line1: address.line1,
            line2: address.line2 ?? null,
            city: address.city,
            province: address.province ?? null,
            postalCode: address.postalCode,
            country: address.country,
          },
    links: links.map((link) => ({
      issuedAt: link.createdAt.toISOString(),
      expiresAt: link.expiresAt.toISOString(),
      claimCount: link.claimCount,
      lastClaimedAt: link.lastClaimedAt?.toISOString() ?? null,
    })),
  };
}
