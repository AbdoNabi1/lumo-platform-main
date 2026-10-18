/** What the list search reads from an order — structurally a slice of `Order`. */
export interface SearchableOrder {
  readonly orderNumber: { readonly value: string };
  readonly customerRef: string;
  readonly shippingAddress: { readonly recipientName?: string; readonly phone?: string };
}

const PHONE_SHAPED = /^[+\d\s().-]+$/;
const MIN_PHONE_DIGITS = 4;

/**
 * The substrings a stored phone is searched for (order operations Part 1 — Egyptian merchants look
 * orders up by phone). The text as typed, plus — when it is phone-shaped — its bare digits and, for a
 * national number, the digits without the leading 0, so `010 1234 5678` finds `+201012345678`.
 */
export function phoneSearchNeedles(search: string): readonly string[] {
  const text = search.trim();
  const needles = new Set<string>([text]);
  if (PHONE_SHAPED.test(text)) {
    const digits = text.replace(/\D/g, "");
    if (digits.length >= MIN_PHONE_DIGITS) {
      needles.add(digits);
      if (digits.startsWith("0")) needles.add(digits.slice(1));
    }
  }
  return [...needles];
}

/**
 * The in-memory mirror of `PrismaOrderRepository`'s search: order number, customer ref or recipient
 * name (case-insensitive substring), or the phone in any of {@link phoneSearchNeedles}' forms.
 */
export function matchesOrderSearch(order: SearchableOrder, search: string): boolean {
  const text = search.trim();
  if (text.length === 0) return true;
  const lower = text.toLowerCase();
  const contains = (value: string | undefined) =>
    value !== undefined && value.toLowerCase().includes(lower);
  if (
    contains(order.orderNumber.value) ||
    contains(order.customerRef) ||
    contains(order.shippingAddress.recipientName)
  ) {
    return true;
  }
  const phone = order.shippingAddress.phone;
  return phone !== undefined && phoneSearchNeedles(text).some((needle) => phone.includes(needle));
}
