import { describe, expect, it, vi } from "vitest";
import type { Order } from "@platform/orders";
import type { WiredAdmin } from "../composition";
import { customerNameOf, customerNamesFor } from "./order-customer-names";

const principal = { id: "staff-1", kind: "staff", roles: ["admin"] } as never;

/** The slice of an Order the lookup reads: who it is for, and whether the shopper typed a recipient. */
function order(customerRef: string, recipientName: string | null | undefined): Order {
  return {
    customerRef,
    shippingAddress: { recipientName },
  } as unknown as Order;
}

function adminAnswering(response: { status: number; body: unknown } | Error) {
  const contactsOfCustomers = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return {
    admin: { customers: { contactsOfCustomers } } as unknown as WiredAdmin,
    contactsOfCustomers,
  };
}

describe("customerNameOf", () => {
  it("prefers the recipient name the shopper typed", () => {
    expect(customerNameOf(order("c-1", "Mona"), new Map([["c-1", "Alice"]]))).toBe("Mona");
  });

  it("falls back to the customer's name, then null", () => {
    expect(customerNameOf(order("c-1", null), new Map([["c-1", "Alice"]]))).toBe("Alice");
    expect(customerNameOf(order("c-9", null), new Map())).toBeNull();
  });

  it("treats a blank recipient name as none", () => {
    expect(customerNameOf(order("c-1", "   "), new Map([["c-1", "Alice"]]))).toBe("Alice");
    expect(customerNameOf(order("c-1", ""), new Map())).toBeNull();
  });
});

describe("customerNamesFor", () => {
  it("makes ONE Identity read for the whole page, asking only for orders without a recipient name", async () => {
    const { admin, contactsOfCustomers } = adminAnswering({ status: 200, body: [] });

    await customerNamesFor(admin, principal, "tenant-a", [
      order("c-1", null),
      order("c-2", "Mona"),
      order("c-3", undefined),
      order("c-1", ""),
    ]);

    expect(contactsOfCustomers).toHaveBeenCalledTimes(1);
    expect(contactsOfCustomers).toHaveBeenCalledWith(principal, {
      tenantId: "tenant-a",
      customerIds: ["c-1", "c-3"],
    });
  });

  it("reads nothing when every order already has a recipient name", async () => {
    const { admin, contactsOfCustomers } = adminAnswering({ status: 200, body: [] });

    const names = await customerNamesFor(admin, principal, "tenant-a", [
      order("c-1", "Mona"),
      order("c-2", "Omar"),
    ]);

    expect(contactsOfCustomers).not.toHaveBeenCalled();
    expect(names.size).toBe(0);
  });

  it("names a customer by name, and a guest by email (a guest's stored name is only a placeholder)", async () => {
    const { admin } = adminAnswering({
      status: 200,
      body: [
        { id: "c-1", name: "Alice", email: "alice@example.com", isGuest: false },
        { id: "c-2", name: "guest", email: "guest@example.com", isGuest: true },
      ],
    });

    const names = await customerNamesFor(admin, principal, "tenant-a", [
      order("c-1", null),
      order("c-2", null),
    ]);

    expect(names.get("c-1")).toBe("Alice");
    expect(names.get("c-2")).toBe("guest@example.com");
  });

  it("falls back to the email for a registered customer whose name is blank", async () => {
    const { admin } = adminAnswering({
      status: 200,
      body: [{ id: "c-1", name: "   ", email: "alice@example.com", isGuest: false }],
    });

    const names = await customerNamesFor(admin, principal, "tenant-a", [order("c-1", null)]);

    expect(names.get("c-1")).toBe("alice@example.com");
  });

  it("leaves an unknown customer out, so the list shows no name for it", async () => {
    const { admin } = adminAnswering({ status: 200, body: [] });

    const names = await customerNamesFor(admin, principal, "tenant-a", [order("customer-1", null)]);

    expect(names.has("customer-1")).toBe(false);
  });

  it("does not fail the page when the customers cannot be read: a name is cosmetic", async () => {
    const refused = adminAnswering({ status: 500, body: {} });
    const thrown = adminAnswering(new Error("identity down"));

    const a = await customerNamesFor(refused.admin, principal, "tenant-a", [order("c-1", null)]);
    const b = await customerNamesFor(thrown.admin, principal, "tenant-a", [order("c-1", null)]);

    expect(a.size).toBe(0);
    expect(b.size).toBe(0);
  });
});
