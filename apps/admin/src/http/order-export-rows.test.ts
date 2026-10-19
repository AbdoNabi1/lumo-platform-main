import { describe, expect, it } from "vitest";
import type { CustomerContact } from "@platform/identity";
import type { Order } from "@platform/orders";
import type { PaymentIntentSummary } from "@platform/payments";
import { codAmountOf, toOrderExportRowDto, toPackingSlipDto } from "./order-export-rows";

const PLACED_AT = new Date("2026-10-18T09:05:00.000Z");
const PENDING = [
  { type: "created", occurredAt: PLACED_AT },
  { type: "payment_requested", occurredAt: PLACED_AT },
];

function stubOrder(overrides: Record<string, unknown> = {}): Order {
  return {
    id: { toString: () => "o-1" },
    orderNumber: { value: "1001" },
    customerRef: "c-1",
    currency: "EGP",
    history: PENDING,
    paymentRef: "i-1",
    shippingAddress: {
      recipientName: "Mona Ali",
      phone: "+201012345678",
      line1: "1 Nile St",
      line2: "Apt 4",
      city: "Cairo",
      province: "EG-C",
      postalCode: "11511",
      country: "EG",
    },
    items: [
      {
        snapshot: { name: "T-shirt", variantTitle: "L", sku: "SKU-1" },
        quantity: 2,
        lineTotal: { amountMinor: 40000 },
      },
      {
        snapshot: { name: "Cap", variantTitle: undefined, sku: undefined },
        quantity: 1,
        lineTotal: { amountMinor: 5000 },
      },
    ],
    totals: {
      subtotalMinor: 45000,
      shippingMinor: 5000,
      discountMinor: 0,
      totalMinor: 50000,
      shippingMethod: "standard",
    },
    totalAmount: () => ({ amountMinor: 50000 }),
    ...overrides,
  } as unknown as Order;
}

const cod: PaymentIntentSummary = {
  id: "i-1",
  orderRef: "o-1",
  provider: "cod",
  status: "created",
  amountMinor: 50000,
  currency: "EGP",
  settlesAtPayTime: true,
  settledByOperatorConfirmation: true,
};
const card: PaymentIntentSummary = {
  ...cod,
  provider: "stripe",
  settlesAtPayTime: false,
  settledByOperatorConfirmation: false,
};
const contact: CustomerContact = {
  id: "c-1",
  name: "Mona",
  email: "mona@example.com",
  isGuest: false,
};

describe("codAmountOf (spec §1.4)", () => {
  it("is the total while a cash-on-delivery payment is pending, else 0", () => {
    expect(codAmountOf(stubOrder(), cod)).toBe(50000);
    expect(codAmountOf(stubOrder(), card)).toBe(0);
    expect(codAmountOf(stubOrder(), undefined)).toBe(0);
    expect(
      codAmountOf(
        stubOrder({ history: [...PENDING, { type: "payment_received", occurredAt: PLACED_AT }] }),
        cod,
      ),
    ).toBe(0);
  });

  it("is 0 when the cash was already received but the order is not yet marked paid", () => {
    expect(codAmountOf(stubOrder(), { ...cod, status: "captured" })).toBe(0);
  });

  it("is 0 for an intent that belongs to another order", () => {
    expect(codAmountOf(stubOrder(), { ...cod, orderRef: "o-2" })).toBe(0);
  });

  it("keeps the total when the intent was cancelled but the order still waits for payment", () => {
    expect(codAmountOf(stubOrder(), { ...cod, status: "cancelled" })).toBe(50000);
  });
});

describe("toOrderExportRowDto", () => {
  it("maps one order to one courier row", () => {
    expect(
      toOrderExportRowDto(stubOrder(), {
        fulfillmentStatus: "unfulfilled",
        contact,
        customerLabels: new Map([["c-1", "Mona"]]),
        intent: cod,
        annotations: { archivedAt: null, note: null, tags: [] },
      }),
    ).toEqual({
      orderId: "o-1",
      orderNumber: "1001",
      createdAt: "2026-10-18T09:05:00.000Z",
      customerName: "Mona Ali",
      email: "mona@example.com",
      phone: "+201012345678",
      line1: "1 Nile St",
      line2: "Apt 4",
      city: "Cairo",
      province: "EG-C",
      country: "EG",
      items: [
        { title: "T-shirt", variantTitle: "L", sku: "SKU-1", quantity: 2 },
        { title: "Cap", variantTitle: null, sku: null, quantity: 1 },
      ],
      itemCount: 3,
      subtotalMinor: 45000,
      shippingMinor: 5000,
      discountMinor: 0,
      totalMinor: 50000,
      codAmountMinor: 50000,
      currency: "EGP",
      paymentStatus: "pending",
      paymentProvider: "cod",
      fulfillmentStatus: "unfulfilled",
      shippingMethod: "standard",
      tags: [],
      note: null,
    });
  });

  it("reads an order placed before totals were captured from its lines", () => {
    const row = toOrderExportRowDto(stubOrder({ totals: undefined, paymentRef: undefined }), {
      fulfillmentStatus: "unfulfilled",
      contact: undefined,
      customerLabels: new Map(),
      intent: undefined,
      annotations: undefined,
    });
    expect(row).toMatchObject({
      subtotalMinor: 45000,
      shippingMinor: 0,
      discountMinor: 0,
      totalMinor: 50000,
      shippingMethod: null,
      paymentProvider: null,
      email: null,
    });
  });

  it("names the customer by label when the shopper typed no recipient", () => {
    const row = toOrderExportRowDto(
      stubOrder({
        shippingAddress: { line1: "1 Nile St", city: "Cairo", postalCode: "", country: "EG" },
      }),
      {
        fulfillmentStatus: "unfulfilled",
        contact,
        customerLabels: new Map([["c-1", "Mona"]]),
        intent: undefined,
        annotations: undefined,
      },
    );
    expect(row).toMatchObject({ customerName: "Mona", phone: null, line2: null, province: null });
  });
});

describe("toPackingSlipDto", () => {
  it("carries the ship-to block, the lines and the cash to collect", () => {
    expect(
      toPackingSlipDto(stubOrder(), {
        customerLabels: new Map(),
        intent: cod,
        annotations: undefined,
      }),
    ).toEqual({
      orderId: "o-1",
      orderNumber: "1001",
      createdAt: "2026-10-18T09:05:00.000Z",
      shipTo: {
        name: "Mona Ali",
        phone: "+201012345678",
        line1: "1 Nile St",
        line2: "Apt 4",
        city: "Cairo",
        province: "EG-C",
        postalCode: "11511",
        country: "EG",
      },
      lines: [
        { title: "T-shirt", variantTitle: "L", sku: "SKU-1", quantity: 2 },
        { title: "Cap", variantTitle: null, sku: null, quantity: 1 },
      ],
      note: null,
      codAmountMinor: 50000,
      currency: "EGP",
    });
  });
});
