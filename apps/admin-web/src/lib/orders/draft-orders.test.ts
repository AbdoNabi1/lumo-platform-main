import { describe, expect, it } from "vitest";
import type { DraftOrderDto } from "@/lib/api/draft-orders";
import {
  canEditDrafts,
  canMarkDraftPaid,
  conflictCodeOf,
  draftListParams,
  draftsHref,
  draftWhatsAppTarget,
  EMPTY_DRAFT_ADDRESS,
  fieldErrorsOf,
  formFromDraft,
  inputFromForm,
  invoiceMessage,
  parseDraftStatus,
  sameDraftForm,
} from "./draft-orders";

describe("draft list helpers", () => {
  it("parses only known statuses", () => {
    expect(parseDraftStatus("invoice_sent")).toBe("invoice_sent");
    expect(parseDraftStatus("archived")).toBeUndefined();
    expect(parseDraftStatus(undefined)).toBeUndefined();
  });

  it("builds tab hrefs that keep the search and drop the cursor", () => {
    expect(draftsHref({ status: undefined, q: undefined })).toBe("/draft-orders");
    expect(draftsHref({ status: "open", q: "#D3" })).toBe("/draft-orders?status=open&q=%23D3");
  });

  it("operators and admins edit; only admins mark paid", () => {
    expect([canEditDrafts("viewer"), canEditDrafts("operator"), canEditDrafts("admin")]).toEqual([
      false,
      true,
      true,
    ]);
    expect([canMarkDraftPaid("operator"), canMarkDraftPaid("admin")]).toEqual([false, true]);
    expect(canEditDrafts(undefined)).toBe(false);
  });

  it("reads the CODE: prefix of a 409 message (Ruling 19)", () => {
    expect(conflictCodeOf("OUT_OF_STOCK: insufficient stock")).toBe("OUT_OF_STOCK");
    expect(conflictCodeOf("Conflict")).toBeNull();
  });
});

describe("draftListParams (hand-edited URLs never break the page)", () => {
  it("reads the plain parameters", () => {
    expect(draftListParams({ status: "open", q: " #D3 ", after: "c1" })).toEqual({
      status: "open",
      q: "#D3",
      after: "c1",
    });
    expect(draftListParams({})).toEqual({ status: undefined, q: undefined, after: undefined });
  });

  it("takes the first of a repeated ?q= and clamps an over-long search to 200", () => {
    expect(draftListParams({ q: ["a", "b"] }).q).toBe("a");
    expect(draftListParams({ q: "x".repeat(250) }).q).toHaveLength(200);
    expect(draftListParams({ q: "   " }).q).toBeUndefined();
  });

  it("ignores a cursor that is repeated or longer than the API takes (64)", () => {
    expect(draftListParams({ after: ["c1", "c2"] }).after).toBeUndefined();
    expect(draftListParams({ after: "c".repeat(65) }).after).toBeUndefined();
    expect(draftListParams({ after: "c".repeat(64) }).after).toHaveLength(64);
    expect(draftListParams({ status: ["open", "completed"] }).status).toBeUndefined();
  });
});

const DTO: DraftOrderDto = {
  id: "d-1",
  draftNumber: "D3",
  status: "open",
  version: 2,
  currency: "EGP",
  createdAt: "2026-10-25T10:00:00.000Z",
  updatedAt: "2026-10-25T10:00:00.000Z",
  invoiceSentAt: null,
  completedAt: null,
  customer: null,
  email: "sara@example.com",
  phone: "01001234567",
  shippingAddress: {
    name: "Mona Ali",
    phone: "01001234567",
    line1: "5 Nile St",
    line2: null,
    city: "Cairo",
    province: "EG-C",
    postalCode: "",
    country: "EG",
  },
  billingAddress: null,
  lines: [
    {
      productId: "p-1",
      variantId: "v-1",
      sku: "TEE",
      title: "Tee",
      variantTitle: "M",
      quantity: 2,
      unitPriceMinor: 25000,
      lineTotalMinor: 50000,
      imageUrl: null,
    },
  ],
  discount: { valueType: "fixed", value: 5000, reason: "Loyal", amountMinor: 5000 },
  shipping: { kind: "rate", method: "standard", title: "Standard", amountMinor: 500 },
  note: "call first",
  tags: ["vip"],
  totals: {
    subtotalMinor: 50000,
    discountMinor: 5000,
    shippingMinor: 500,
    taxMinor: 0,
    taxIncluded: true,
    totalMinor: 45500,
  },
  order: null,
  links: [],
  missing: { invoice: [], complete: [] },
};

describe("draft form", () => {
  it("round-trips a draft into the API input — ids and quantities only, no price", () => {
    const input = inputFromForm(formFromDraft(DTO), "Custom discount");
    expect(input).toEqual({
      customerId: null,
      email: "sara@example.com",
      phone: "01001234567",
      shippingAddress: {
        name: "Mona Ali",
        phone: "01001234567",
        line1: "5 Nile St",
        city: "Cairo",
        province: "EG-C",
        postalCode: "",
        country: "EG",
      },
      billingAddress: null,
      lines: [{ productId: "p-1", variantId: "v-1", quantity: 2 }],
      discount: { valueType: "fixed", value: 5000, reason: "Loyal" },
      shipping: { kind: "rate", method: "standard" },
      note: "call first",
      tags: ["vip"],
    });
    expect(JSON.stringify(input)).not.toContain("25000");
  });

  it("fills an empty discount reason with the localized default (Ruling 13)", () => {
    const form = {
      ...formFromDraft(DTO),
      discount: { valueType: "percentage" as const, value: 10, reason: "  " },
    };
    expect(inputFromForm(form, "خصم مخصص").discount).toEqual({
      valueType: "percentage",
      value: 10,
      reason: "خصم مخصص",
    });
  });

  it("names free shipping in the merchant's language (final review M-2)", () => {
    const form = { ...formFromDraft(DTO), shipping: { kind: "free" as const } };
    expect(inputFromForm(form, "خصم مخصص", "شحن مجاني").shipping).toEqual({
      kind: "free",
      title: "شحن مجاني",
    });
    // Comparing forms ignores the name: it is not something the merchant typed.
    expect(inputFromForm(form, "").shipping).toEqual({ kind: "free" });
  });

  it("a new draft starts empty, with billing same as shipping", () => {
    const empty = formFromDraft(null);
    expect(empty.lines).toEqual([]);
    expect(empty.billingSame).toBe(true);
    expect(empty.shippingAddress).toBeNull();
    expect(EMPTY_DRAFT_ADDRESS.country).toBe("EG");
  });

  it("sends a separate billing address only when it is not the shipping one", () => {
    const form = {
      ...formFromDraft(DTO),
      billingSame: false,
      billingAddress: { ...EMPTY_DRAFT_ADDRESS, line1: " 1 Tahrir ", city: "Giza" },
    };
    expect(inputFromForm(form, "").billingAddress).toEqual({
      line1: "1 Tahrir",
      city: "Giza",
      postalCode: "",
      country: "EG",
    });
    expect(inputFromForm({ ...form, billingSame: true }, "").billingAddress).toBeNull();
  });

  it("dirty compares what would be sent, not display data", () => {
    const a = formFromDraft(DTO);
    expect(sameDraftForm(a, { ...a, lines: a.lines.map((l) => ({ ...l, imageUrl: "x" })) })).toBe(
      true,
    );
    expect(sameDraftForm(a, { ...a, note: "other" })).toBe(false);
  });

  it("maps API field issues to a field → message record", () => {
    expect(
      fieldErrorsOf([
        { field: "lines.0", message: "gone" },
        { field: "email", message: "bad" },
      ]),
    ).toEqual({ "lines.0": "gone", email: "bad" });
  });
});

describe("draftWhatsAppTarget (Review Focus 5)", () => {
  it.each([
    [
      "the draft phone",
      { phone: "01001234567", shipping: null },
      { phone: "01001234567", country: null },
    ],
    [
      "the draft phone, with the shipping country",
      { phone: "01001234567", shipping: { phone: "01119998888", country: "SA" } },
      { phone: "01001234567", country: "SA" },
    ],
    [
      "else the shipping phone and its country",
      { phone: "", shipping: { phone: "٠١٠٠١٢٣٤٥٦٧", country: "EG" } },
      { phone: "٠١٠٠١٢٣٤٥٦٧", country: "EG" },
    ],
    ["nothing → the chat picker", { phone: " ", shipping: null }, { phone: null, country: null }],
  ])("%s", (_name, given, expected) => {
    const form = {
      ...formFromDraft(null),
      phone: given.phone,
      shippingAddress:
        given.shipping === null
          ? null
          : {
              ...EMPTY_DRAFT_ADDRESS,
              phone: given.shipping.phone,
              country: given.shipping.country,
            },
    };
    expect(draftWhatsAppTarget(form)).toEqual(expected);
  });

  it("fills the invoice message literally", () => {
    expect(
      invoiceMessage("Hi {name}, #{draft} from {shop}: {total} {url}", {
        name: "Mona $&",
        draft: "D3",
        shop: "Shop",
        total: "EGP 455.00",
        url: "https://s/c/x",
      }),
    ).toBe("Hi Mona $&, #D3 from Shop: EGP 455.00 https://s/c/x");
  });
});
