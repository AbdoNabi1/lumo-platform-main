import { describe, expect, it } from "vitest";
import {
  DraftOrder,
  draftAmounts,
  draftRequirements,
  MAX_DRAFT_LINES,
  normalizeDraftContent,
  normalizeDraftSearch,
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
    for (const snapshot of [
      { ...base, status: "completed" as const, orderRef: "o-1", completedAt: NOW },
      { ...base, deletedAt: NOW },
    ]) {
      const result = DraftOrder.reconstitute(snapshot).revise(content(), NOW);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/^DRAFT_(COMPLETED|DELETED):/);
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
