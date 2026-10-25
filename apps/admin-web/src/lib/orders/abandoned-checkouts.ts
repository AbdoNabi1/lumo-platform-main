import type {
  AbandonedCheckoutDetailDto,
  AbandonedCheckoutListItemDto,
  AbandonedRecoveryStatus,
} from "@/lib/api/abandoned-checkouts";

/** Shopify's page size; the API's maximum too. */
export const ABANDONED_PAGE_SIZE = 50;

export function parseRecoveryFilter(raw: string | undefined): AbandonedRecoveryStatus | undefined {
  return raw === "recovered" || raw === "not_recovered" ? raw : undefined;
}

/** Shopify's "Placed by": the recipient's name, else the email, else the phone. */
export function placedByLabel(
  item: Pick<AbandonedCheckoutListItemDto, "customerName" | "email" | "phone">,
): string | null {
  return item.customerName ?? item.email ?? item.phone;
}

/** `orders:recover_checkout` is held by operators and admins (the API decides; this only hides buttons). */
export function canRecoverCheckout(role: string | undefined): boolean {
  return role === "admin" || role === "operator";
}

/** The API's absolute URL (the shop's own domain), else `STOREFRONT_URL` + the path, else none. */
export function recoveryLinkHref(
  link: { readonly url: string | null; readonly path: string },
  storefrontUrl: string | null,
): string | null {
  if (link.url !== null) return link.url;
  const base = storefrontUrl?.trim().replace(/\/+$/, "") ?? "";
  return base === "" ? null : `${base}${link.path}`;
}

export type AbandonedTimelineKind =
  "started" | "last_activity" | "link_issued" | "link_opened" | "recovered";

export interface AbandonedTimelineEvent {
  readonly key: string;
  readonly kind: AbandonedTimelineKind;
  /** ISO time; null for "recovered" (the order page has the time). */
  readonly at: string | null;
  readonly count?: number;
  readonly orderId?: string;
  readonly orderNumber?: string | null;
}

/** The detail page's small timeline (spec §3.7): newest first, the recovery (when any) on top. */
export function abandonedTimeline(
  detail: Pick<
    AbandonedCheckoutDetailDto,
    "createdAt" | "lastActivityAt" | "links" | "recoveredOrder"
  >,
): AbandonedTimelineEvent[] {
  const dated: AbandonedTimelineEvent[] = [
    { key: "started", kind: "started", at: detail.createdAt },
  ];
  if (detail.lastActivityAt !== detail.createdAt) {
    dated.push({ key: "last-activity", kind: "last_activity", at: detail.lastActivityAt });
  }
  detail.links.forEach((link, index) => {
    dated.push({ key: `link-${index}`, kind: "link_issued", at: link.issuedAt });
    if (link.claimCount > 0 && link.lastClaimedAt !== null) {
      dated.push({
        key: `opened-${index}`,
        kind: "link_opened",
        at: link.lastClaimedAt,
        count: link.claimCount,
      });
    }
  });
  // ISO-8601 instants in UTC sort as strings.
  dated.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  const recovered = detail.recoveredOrder;
  return recovered === null
    ? dated
    : [
        {
          key: "recovered",
          kind: "recovered",
          at: null,
          orderId: recovered.id,
          orderNumber: recovered.orderNumber,
        },
        ...dated,
      ];
}
