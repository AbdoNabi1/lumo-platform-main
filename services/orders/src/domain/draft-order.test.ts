import { describe, expect, it } from "vitest";
import { MAX_TAGS_PER_ORDER } from "./order-tags";
import {
  DraftOrder,
  draftAmounts,
  draftRequirements,
  MAX_DRAFT_LINES,
  normalizeDraftContent,
  normalizeDraftSearch,
  MAX_DRAFT_INT4_MINOR,
  type DraftLine,
  type DraftOrderContent,
} from "./draft-order";

const NOW = new Date("2026-10-25T10:00:00.000Z");
const line = (over: Partial<DraftLine> = {}): DraftLine => ({
  productRef: "11111111-1111-7111-8111-111111111111",
  variantRef: "22222222-2222-7222-8222-222222222222",
  sku: "TEE-M",
  title: "Tee",
  variantTitle: "M",
  quantity: 2,
  unitPriceMinor: 25000,
  ...over,
});
const ADDRESS = {
  name: "Mona Ali",
  phone: "01001234567",
  line1: "5 Nile St",
  line2: null,
  city: "Cairo",
  province: "EG-C",
  postalCode: "",
  country: "EG",
};
const content = (over: Partial<DraftOrderContent> = {}): DraftOrderContent => ({
  customerRef: null,
  contactEmail: null,
  contactPhone: null,
  shippingAddress: ADDRESS,
  billingAddress: null,
  lines: [line()],
  discount: null,
  shipping: { kind: "custom", title: "Courier", amountMinor: 5000 },
  note: null,
  tags: [],
  ...over,
});
function value<T>(
  r: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: Error },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}
const fieldsOf = (r: { readonly ok: boolean; readonly error?: unknown }): string[] =>
  r.ok ? [] : ((r.error as { fields?: { field: string }[] }).fields ?? []).map((f) => f.field);

describe("draftAmounts (Review Focus 4)", () => {
  it.each([
    ["no discount", null, 50000, 0],
    ["fixed below subtotal", { valueType: "fixed", value: 7000, reason: null }, 50000, 7000],
    [
      "fixed above subtotal is capped",
      { valueType: "fixed", value: 90000, reason: null },
      50000,
      50000,
    ],
    ["10 %", { valueType: "percentage", value: 10, reason: null }, 50000, 5000],
    ["100 %", { valueType: "percentage", value: 100, reason: null }, 50000, 50000],
    [
      "percentage rounds to the nearest minor unit",
      { valueType: "percentage", value: 15, reason: null },
      333,
      50,
    ],
  ] as const)("%s", (_name, discount, subtotal, expected) => {
    const amounts = draftAmounts({
      lines: [line({ quantity: 1, unitPriceMinor: subtotal })],
      discount,
      shipping: { kind: "custom", title: "Courier", amountMinor: 5000 },
    });
    expect(amounts.subtotalMinor).toBe(subtotal);
    expect(amounts.discountMinor).toBe(expected);
    expect(amounts.totalBeforeTaxMinor).toBe(subtotal - expected + 5000);
    expect(amounts.totalBeforeTaxMinor).toBeGreaterThanOrEqual(0);
  });
});

describe("normalizeDraftContent", () => {
  it("merges identical variants, trims, drops blanks and dedupes tags", () => {
    const normalized = value(
      normalizeDraftContent(
        content({
          lines: [line({ quantity: 1 }), line({ quantity: 3 })],
          contactEmail: "  sara@example.com ",
          contactPhone: "   ",
          note: "  call first  ",
          tags: ["VIP", "vip", "urgent, gift"],
          discount: { valueType: "fixed", value: 1000, reason: "  " },
        }),
      ),
    );
    expect(normalized.lines).toHaveLength(1);
    expect(normalized.lines[0]?.quantity).toBe(4);
    expect(normalized.contactEmail).toBe("sara@example.com");
    expect(normalized.contactPhone).toBeNull();
    expect(normalized.note).toBe("call first");
    expect(normalized.tags).toEqual(["VIP", "urgent", "gift"]);
    expect(normalized.discount).toEqual({ valueType: "fixed", value: 1000, reason: null });
  });

  const many = Array.from({ length: MAX_DRAFT_LINES + 1 }, (_, i) =>
    line({ variantRef: `v-${i}` }),
  );
  const text = (length: number) => "x".repeat(length);
  const lineA = line({ variantRef: "va", quantity: 1 });
  const lineC = (quantity: number) => line({ variantRef: "vc", quantity });
  it.each([
    ["no lines", { lines: [] }, "lines"],
    ["too many lines", { lines: many }, "lines"],
    ["quantity 0", { lines: [line({ quantity: 0 })] }, "lines.0.quantity"],
    ["quantity 10000", { lines: [line({ quantity: 10000 })] }, "lines.0.quantity"],
    [
      "percentage 101",
      { discount: { valueType: "percentage", value: 101, reason: null } },
      "discount.value",
    ],
    [
      "fixed above the cap",
      { discount: { valueType: "fixed", value: 10_000_001, reason: null } },
      "discount.value",
    ],
    [
      "negative shipping",
      { shipping: { kind: "custom", title: "X", amountMinor: -1 } },
      "shipping.amountMinor",
    ],
    [
      "blank custom shipping title",
      { shipping: { kind: "custom", title: " ", amountMinor: 1 } },
      "shipping.title",
    ],
    [
      "a discount reason over 255 characters",
      { discount: { valueType: "fixed", value: 1000, reason: text(256) } },
      "discount.reason",
    ],
    [
      "a custom shipping title over 100 characters",
      { shipping: { kind: "custom", title: text(101), amountMinor: 1 } },
      "shipping.title",
    ],
    ["a contact phone over 32 characters", { contactPhone: text(33) }, "phone"],
    [
      "an address phone over 32 characters",
      { shippingAddress: { ...ADDRESS, phone: text(33) } },
      "shippingAddress.phone",
    ],
    [
      "a merged quantity over 9,999",
      { lines: [line({ quantity: 9000 }), line({ quantity: 9000 })] },
      "lines.0.quantity",
    ],
    [
      "more than the maximum number of tags",
      { tags: Array.from({ length: MAX_TAGS_PER_ORDER + 1 }, (_, i) => `t${i}`) },
      "tags",
    ],
    [
      "an address name over 200 characters",
      { shippingAddress: { ...ADDRESS, name: text(201) } },
      "shippingAddress.name",
    ],
    [
      "an address line2 over 200 characters",
      { billingAddress: { ...ADDRESS, line2: text(201) } },
      "billingAddress.line2",
    ],
    [
      "an address province over 200 characters",
      { shippingAddress: { ...ADDRESS, province: text(201) } },
      "shippingAddress.province",
    ],
    [
      "a postal code over 32 characters",
      { shippingAddress: { ...ADDRESS, postalCode: text(33) } },
      "shippingAddress.postalCode",
    ],
    ["a customer ref over 64 characters", { customerRef: text(65) }, "customerRef"],
    [
      "a free shipping title over 200 characters",
      { shipping: { kind: "free", title: text(201), amountMinor: 0 } },
      "shipping.title",
    ],
    [
      "a rate method over 200 characters",
      { shipping: { kind: "rate", method: text(201), title: "Standard", amountMinor: 1 } },
      "shipping.method",
    ],
    [
      "a unit price above INT4",
      { lines: [line({ unitPriceMinor: MAX_DRAFT_INT4_MINOR + 1, quantity: 1 })] },
      "lines.0.unitPriceMinor",
    ],
    [
      "a rate above INT4",
      {
        shipping: {
          kind: "rate",
          method: "std",
          title: "Standard",
          amountMinor: MAX_DRAFT_INT4_MINOR + 1,
        },
      },
      "shipping.amountMinor",
    ],
    [
      "a subtotal that no longer fits INT4",
      { lines: [line({ unitPriceMinor: 1_000_000_000, quantity: 3 })] },
      "lines",
    ],
    [
      "a subtotal plus shipping that no longer fits INT4",
      {
        lines: [line({ unitPriceMinor: MAX_DRAFT_INT4_MINOR, quantity: 1 })],
        shipping: { kind: "custom", title: "Courier", amountMinor: 1 },
      },
      "lines",
    ],
    ["a bad email", { contactEmail: "not-an-email" }, "email"],
    [
      "an address without a city",
      { shippingAddress: { ...ADDRESS, city: " " } },
      "shippingAddress.city",
    ],
  ] as const)("refuses %s", (_name, over, field) => {
    expect(fieldsOf(normalizeDraftContent(content(over as Partial<DraftOrderContent>)))).toContain(
      field,
    );
  });

  it("names the first input row of a merged variant when the merged quantity is over the cap", () => {
    const fields = fieldsOf(
      normalizeDraftContent(content({ lines: [lineA, lineA, lineC(9999), lineC(1)] })),
    );
    expect(fields).toContain("lines.2.quantity");
    expect(fields).not.toContain("lines.1.quantity");
  });

  it("says the total is too large with a clear message", () => {
    const result = normalizeDraftContent(
      content({ lines: [line({ unitPriceMinor: 1_000_000_000, quantity: 3 })] }),
    );
    const issues = result.ok ? [] : result.error.fields;
    expect(issues).toContainEqual({ field: "lines", message: "total too large" });
  });

  it("accepts catalog prices and quoted rates above the merchant-entered cap", () => {
    const normalized = value(
      normalizeDraftContent(
        content({
          lines: [line({ unitPriceMinor: 10_000_001, quantity: 1 })],
          shipping: { kind: "rate", method: "std", title: "Standard", amountMinor: 10_000_001 },
        }),
      ),
    );
    expect(normalized.lines[0]?.unitPriceMinor).toBe(10_000_001);
    expect(normalized.shipping?.amountMinor).toBe(10_000_001);
  });

  it("still caps the merchant-entered amounts at 10,000,000", () => {
    expect(
      fieldsOf(
        normalizeDraftContent(
          content({ shipping: { kind: "custom", title: "X", amountMinor: 10_000_001 } }),
        ),
      ),
    ).toContain("shipping.amountMinor");
  });

  it("accepts a total of exactly INT4 max", () => {
    const normalized = normalizeDraftContent(
      content({
        lines: [line({ unitPriceMinor: MAX_DRAFT_INT4_MINOR, quantity: 1 })],
        shipping: { kind: "free", title: "", amountMinor: 0 },
      }),
    );
    expect(normalized.ok).toBe(true);
  });

  it("gives free shipping its title and a zero amount", () => {
    const normalized = value(
      normalizeDraftContent(content({ shipping: { kind: "free", title: "", amountMinor: 0 } })),
    );
    expect(normalized.shipping).toEqual({ kind: "free", title: "Free shipping", amountMinor: 0 });
  });
});

describe("draftRequirements", () => {
  it("an invoice needs lines, an address and a shipping choice; completing a guest also needs an email", () => {
    const bare = content({ shippingAddress: null, shipping: null });
    expect(draftRequirements(bare, "invoice")).toEqual(["shipping_address", "shipping"]);
    expect(draftRequirements(bare, "complete")).toEqual(["shipping_address", "shipping", "email"]);
    expect(draftRequirements(content({ contactEmail: "a@b.co" }), "complete")).toEqual([]);
    expect(draftRequirements(content({ customerRef: "c-1" }), "complete")).toEqual([]);
    expect(draftRequirements(content({ contactPhone: "0100" }), "complete")).toEqual(["email"]);
  });
});

describe("DraftOrder", () => {
  const created = () =>
    value(
      DraftOrder.create({
        id: "33333333-3333-7333-8333-333333333333",
        draftNumber: "D1",
        currency: "EGP",
        createdBy: "staff-op",
        now: NOW,
        content: content(),
      }),
    );

  it("starts open, new, version 0", () => {
    const draft = created();
    expect(draft.isNew).toBe(true);
    expect(draft.status).toBe("open");
    expect(draft.version).toBe(0);
    expect(draft.isEditable).toBe(true);
  });

  it("refuses to revise a completed or a deleted draft", () => {
    const base = created().snapshot();
    const cases = [
      ["DRAFT_COMPLETED", { ...base, status: "completed" as const, orderRef: "o-1" }],
      ["DRAFT_DELETED", { ...base, deletedAt: NOW }],
    ] as const;
    for (const [code, snapshot] of cases) {
      const result = DraftOrder.reconstitute(snapshot).revise(content(), NOW);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(new RegExp(`^${code}:`));
    }
  });

  it("revises the content and the update time", () => {
    const draft = DraftOrder.reconstitute(created().snapshot());
    const later = new Date(NOW.getTime() + 60_000);
    expect(draft.revise(content({ note: "new" }), later).ok).toBe(true);
    expect(draft.note).toBe("new");
    expect(draft.updatedAt).toEqual(later);
  });
});

describe("normalizeDraftSearch", () => {
  it("strips the # and trims; blank is none", () => {
    expect(normalizeDraftSearch(" #D3 ")).toBe("D3");
    expect(normalizeDraftSearch("   ")).toBeUndefined();
  });
});
