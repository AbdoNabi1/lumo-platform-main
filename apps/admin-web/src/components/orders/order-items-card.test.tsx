import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { OrderDetailDto, OrderDetailItemDto } from "@/lib/api/orders";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { OrderItemsCard } from "./order-items-card";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/orders/[orderId]/fulfillment/actions", () => ({ createFulfillmentAction: vi.fn() }));

function item(overrides: Partial<OrderDetailItemDto> = {}): OrderDetailItemDto {
  return {
    id: "item-1",
    productId: "product-1",
    name: "Cotton shirt",
    variantRef: "variant-29",
    sku: "SHIRT-29",
    variantTitle: "29",
    unitPriceMinor: 1999,
    quantity: 1,
    lineTotalMinor: 1999,
    ...overrides,
  };
}

function order(overrides: Partial<OrderDetailDto> = {}): OrderDetailDto {
  return {
    id: "order-1",
    orderNumber: "1001",
    customerRef: "customer-1",
    status: "payment_requested",
    currency: "USD",
    totalMinor: 5997,
    createdAt: new Date(2026, 9, 9, 20, 27).toISOString(),
    items: [
      item({ id: "item-1", variantTitle: "29", sku: "SHIRT-29" }),
      item({ id: "item-2", variantTitle: "30", sku: "SHIRT-30" }),
      item({ id: "item-3", variantTitle: "31", sku: "SHIRT-31" }),
    ],
    shippingAddress: {
      line1: "12 Tahrir St",
      city: "Cairo",
      postalCode: "11511",
      country: "EG",
      recipientName: "Mona Ali",
      phone: "+201012345678",
      line2: null,
    },
    billingAddress: null,
    totals: null,
    checkoutRef: "checkout-1",
    paymentRef: "intent-1",
    fulfillmentRef: null,
    history: [],
    paymentStatus: "pending",
    fulfillmentStatus: "unfulfilled",
    paymentProvider: "cod",
    shippingMethod: "standard",
    ...overrides,
  };
}

beforeEach(() => undefined);

const renderCard = (o: OrderDetailDto, locale: "en" | "ar" = "en") =>
  render(<OrderItemsCard order={o} t={locale === "en" ? en : ar} locale={locale} />);

describe("OrderItemsCard — the fulfillment card like Shopify's (Plan 3B)", () => {
  it("is titled with the fulfillment status and the number of items", () => {
    renderCard(order());

    expect(screen.getByText("Unfulfilled (3)")).toBeInTheDocument();
  });

  it("counts units, not lines", () => {
    renderCard(order({ items: [item({ quantity: 2, lineTotalMinor: 3998 })] }));

    expect(screen.getByText("Unfulfilled (2)")).toBeInTheDocument();
  });

  it("names the delivery method", () => {
    renderCard(order({ shippingMethod: "standard" }));

    expect(screen.getByText("Delivery method: Standard shipping")).toBeInTheDocument();
  });

  it("says so when no delivery method was recorded", () => {
    renderCard(order({ shippingMethod: null }));

    expect(screen.getByText("Delivery method: not recorded")).toBeInTheDocument();
  });

  it("lists each item with its variant title, SKU, price × quantity and line total", () => {
    renderCard(order());

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    const first = within(rows[0] as HTMLElement);
    expect(first.getByRole("link", { name: "Cotton shirt" })).toHaveAttribute(
      "href",
      "/products/product-1",
    );
    expect(first.getByText("29")).toBeInTheDocument();
    expect(first.getByText("SKU: SHIRT-29")).toBeInTheDocument();
    expect(first.getByText("$19.99 × 1")).toBeInTheDocument();
    expect(first.getByText("$19.99", { selector: "p.font-medium" })).toBeInTheDocument();
    // The same product in two sizes no longer looks like a duplicate.
    expect(within(rows[1] as HTMLElement).getByText("SKU: SHIRT-30")).toBeInTheDocument();
  });

  it("shows no variant or SKU line for an item that has neither (a legacy order)", () => {
    renderCard(order({ items: [item({ variantRef: null, sku: null, variantTitle: null })] }));

    expect(screen.queryByText(/SKU:/)).toBeNull();
  });

  it("shows Fulfill items only while nothing is fulfilled", () => {
    renderCard(order({ fulfillmentStatus: "unfulfilled" }));

    expect(screen.getByRole("button", { name: "Fulfill items" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View fulfillment" })).toBeNull();
  });

  it("offers Fulfill items on a cash-on-delivery order whose payment is still pending", () => {
    renderCard(order({ paymentStatus: "pending", paymentProvider: "cod" }));

    expect(screen.getByRole("button", { name: "Fulfill items" })).toBeEnabled();
  });

  it.each(["in_progress", "fulfilled", "delivered"] as const)(
    "shows View fulfillment instead of Fulfill items once it is %s",
    (fulfillmentStatus) => {
      renderCard(order({ fulfillmentStatus }));

      expect(screen.queryByRole("button", { name: "Fulfill items" })).toBeNull();
      expect(screen.getByRole("link", { name: "View fulfillment" })).toHaveAttribute(
        "href",
        "/orders/order-1/fulfillment",
      );
    },
  );

  it.each(["cancelled", "closed", "refunded"])(
    "offers nothing to fulfill on an order that is %s",
    (status) => {
      renderCard(order({ status }));

      expect(screen.queryByRole("button", { name: "Fulfill items" })).toBeNull();
    },
  );

  it("submits every item through the existing open-fulfillment form fields", () => {
    const { container } = renderCard(order());

    const form = container.querySelector("form") as HTMLFormElement;
    const data = new FormData(form);
    expect(data.get("orderRef")).toBe("order-1");
    expect(data.getAll("includeItem")).toEqual(["item-1", "item-2", "item-3"]);
    expect(data.get("productRef_item-2")).toBe("product-1");
    expect(data.get("quantity_item-3")).toBe("1");
  });

  it("renders in Arabic", () => {
    renderCard(order(), "ar");

    expect(screen.getByText("لم يتم التجهيز (3)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تجهيز المنتجات" })).toBeInTheDocument();
    expect(screen.getByText("طريقة الشحن: شحن عادي")).toBeInTheDocument();
  });
});
