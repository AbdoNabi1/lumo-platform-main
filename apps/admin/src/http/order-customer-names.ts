import type { Principal } from "@platform/contracts";
import type { CustomerContact } from "@platform/identity";
import type { Order } from "@platform/orders";
import { logger } from "@platform/utils";
import type { WiredAdmin } from "../composition";

/** The recipient the shopper typed on the shipping address, or `null` when there is none (or only blanks). */
function typedRecipient(order: Order): string | null {
  const typed = order.shippingAddress.recipientName?.trim();
  return typed === undefined || typed.length === 0 ? null : typed;
}

/**
 * What to call a customer on a list: a guest by their email (their stored name is only the local
 * part of it, a placeholder), anyone else by name, else by email.
 */
function labelOf(contact: CustomerContact): string {
  const name = contact.name.trim();
  return contact.isGuest || name.length === 0 ? contact.email : name;
}

/**
 * The name to show for an order: the recipient the shopper typed, else the label of its customer in
 * `names` (see {@link customerNamesFor}), else `null` (an unknown customer, shown as a dash).
 */
export function customerNameOf(order: Order, names: ReadonlyMap<string, string>): string | null {
  return typedRecipient(order) ?? names.get(order.customerRef) ?? null;
}

/**
 * The labels of the customers of the orders on a page that have no typed recipient, from ONE batched
 * read of Identity (never a call per order, and none at all when every order has a recipient). A read
 * that fails gives no labels rather than failing the page: a name is cosmetic, like the payment
 * provider on the order page.
 */
export async function customerNamesFor(
  admin: Pick<WiredAdmin, "customers">,
  principal: Principal,
  tenantId: string,
  orders: readonly Order[],
): Promise<ReadonlyMap<string, string>> {
  const names = new Map<string, string>();
  const customerIds = [
    ...new Set(orders.filter((order) => typedRecipient(order) === null).map((o) => o.customerRef)),
  ];
  if (customerIds.length === 0) return names;
  try {
    const response = await admin.customers.contactsOfCustomers(principal, {
      tenantId,
      customerIds,
    });
    if (response.status !== 200) {
      logger.warn("customer names unavailable", { tenantId, status: response.status });
      return names;
    }
    for (const contact of response.body as readonly CustomerContact[]) {
      names.set(contact.id, labelOf(contact));
    }
  } catch (error) {
    logger.warn("customer names unavailable", {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return names;
}
