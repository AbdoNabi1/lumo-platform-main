import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { CheckoutSession } from "./checkout-session";
import { CheckoutAddress } from "./value-objects/checkout-address";
import { CheckoutItem } from "./value-objects/checkout-item";
import { draftCartRef, type DraftTerms } from "./value-objects/draft-terms";
import { ShippingSelection } from "./value-objects/selections";

function must<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error("invalid fixture");
  return r.value;
}

const DRAFT_ID = "33333333-3333-7333-8333-333333333333";
const TERMS: DraftTerms = {
  draftOrderRef: DRAFT_ID,
  draftNumber: "D3",
  discount: { title: "Loyal customer", amountMinor: 5000 },
  shipping: { title: "Courier", amountMinor: 4000 },
};

function draftSession(): CheckoutSession {
  const session = CheckoutSession.start(
    UniqueEntityId.from("01920000-0000-7000-8000-000000000001"),
    draftCartRef(DRAFT_ID),
    undefined,
    "server-minted-ref",
    "EGP",
  );
  session.loadItems([must(CheckoutItem.create("p-1", 2, 25000, "EGP"))]);
  session.setShippingAddress(
    must(
      CheckoutAddress.create({ line1: "1 Nile St", city: "Cairo", postalCode: "", country: "EG" }),
    ),
  );
  return session;
}

describe("CheckoutSession draft terms (spec §4.4)", () => {
  it("fixes the shipping and writes ONE draft discount entry; totals follow", () => {
    const session = draftSession();
    session.applyDraftTerms(TERMS);
    expect(session.draftTerms).toEqual(TERMS);
    expect(session.shippingSelection?.method).toBe("draft");
    expect(session.shippingSelection?.rateAmountMinor).toBe(4000);
    expect(session.shippingSelection?.name).toBe("Courier");
    expect(session.discountSnapshot?.applied).toEqual([
      {
        promotionId: `draft:${DRAFT_ID}`,
        title: "Loyal customer",
        discountClass: "order",
        amountMinor: 5000,
      },
    ]);
    expect(session.discountMinor).toBe(5000);
    session.recalculateTotals("evt-1", new Date(0));
    expect(session.totals?.totalMinor).toBe(50000 - 5000 + 4000);
  });

  it("no discount writes an empty snapshot (never a promotion lookup)", () => {
    const session = draftSession();
    session.applyDraftTerms({ ...TERMS, discount: undefined });
    expect(session.discountSnapshot?.applied).toEqual([]);
    expect(session.discountMinor).toBe(0);
  });

  it("refuses a discount above the subtotal, negative amounts, and terms without items (Review Focus 4)", () => {
    expect(() =>
      draftSession().applyDraftTerms({ ...TERMS, discount: { title: "x", amountMinor: 50001 } }),
    ).toThrow(/subtotal/);
    expect(() =>
      draftSession().applyDraftTerms({ ...TERMS, shipping: { title: "x", amountMinor: -1 } }),
    ).toThrow();
    const empty = CheckoutSession.start(
      UniqueEntityId.from("01920000-0000-7000-8000-000000000002"),
      "c",
      undefined,
      "r",
      "EGP",
    );
    expect(() => empty.applyDraftTerms(TERMS)).toThrow(/items/);
  });

  it("refuses another draft's terms on the same session", () => {
    const session = draftSession();
    session.applyDraftTerms(TERMS);
    expect(() => session.applyDraftTerms({ ...TERMS, draftOrderRef: "other" })).toThrow();
  });

  it("locks what the merchant fixed: items, shipping, codes, promotion snapshots (DRAFT_LOCKED)", () => {
    const session = draftSession();
    session.applyDraftTerms(TERMS);
    const item = must(CheckoutItem.create("p-1", 1, 1, "EGP"));
    const selection = must(ShippingSelection.create("standard", 0, "EGP"));
    expect(() => session.loadItems([item])).toThrow(/^DRAFT_LOCKED:/);
    expect(() => session.selectShipping(selection)).toThrow(/^DRAFT_LOCKED:/);
    expect(() => session.enterDiscountCode("SAVE10")).toThrow(/^DRAFT_LOCKED:/);
    expect(() => session.removeDiscountCode("SAVE10")).toThrow(/^DRAFT_LOCKED:/);
    // The admin promotion route (POST /checkouts/:id/promotion) cannot move a draft's discount either.
    expect(() => session.applyPromotionSnapshot(1)).toThrow(/^DRAFT_LOCKED:/);
    expect(() =>
      session.applyDiscountSnapshot({
        applied: [],
        orderDiscountMinor: 1,
        shippingDiscountMinor: 0,
        codeStatuses: [],
        lineAllocations: [],
      }),
    ).toThrow(/^DRAFT_LOCKED:/);
    expect(session.discountMinor).toBe(5000);
    // Contact and addresses stay open to the shopper.
    session.setShippingAddress(
      must(
        CheckoutAddress.create({ line1: "2 Nile St", city: "Giza", postalCode: "", country: "EG" }),
      ),
    );
    expect(session.shippingAddress?.line1).toBe("2 Nile St");
  });

  it("transfers ownership only for an open draft session (Ruling 22)", () => {
    const session = draftSession();
    expect(() => session.transferOwnership("guest-2")).toThrow();
    session.applyDraftTerms(TERMS);
    session.transferOwnership("guest-2");
    expect(session.sessionRef).toBe("guest-2");
    expect(() => session.transferOwnership(" ")).toThrow();
    session.expire("evt-x", new Date(0));
    expect(() => session.transferOwnership("guest-3")).toThrow();
  });

  describe("INT4 ceiling (checkout stores totals as 32-bit integers)", () => {
    const INT4_MAX = 2_147_483_647;

    /** A draft whose subtotal plus shipping sits exactly at the ceiling: the most Orders can issue. */
    function maxedDraft(): CheckoutSession {
      const session = CheckoutSession.start(
        UniqueEntityId.from("01920000-0000-7000-8000-000000000003"),
        draftCartRef(DRAFT_ID),
        undefined,
        "server-minted-ref",
        "EGP",
      );
      session.loadItems([must(CheckoutItem.create("p-1", 1, INT4_MAX - 4000, "EGP"))]);
      session.applyDraftTerms({ ...TERMS, discount: undefined });
      return session;
    }

    it("accepts a draft total exactly at the ceiling", () => {
      const session = maxedDraft();
      session.recalculateTotals("evt-1", new Date(0));
      expect(session.totals?.totalMinor).toBe(INT4_MAX);
    });

    it("refuses tax that pushes the total over the ceiling, leaving the totals unset", () => {
      const session = maxedDraft();
      session.applyTaxSnapshot(1, false);
      expect(() => session.recalculateTotals("evt-1", new Date(0))).toThrow(/too large/);
      expect(session.totals).toBeUndefined();
      expect(session.domainEvents).toHaveLength(0);
    });

    it("lets tax that is already inside the prices through", () => {
      const session = maxedDraft();
      session.applyTaxSnapshot(1000, true);
      session.recalculateTotals("evt-1", new Date(0));
      expect(session.totals?.totalMinor).toBe(INT4_MAX);
    });

    it("refuses a tax figure that alone exceeds the ceiling", () => {
      const session = draftSession();
      session.applyDraftTerms(TERMS);
      expect(() => session.applyTaxSnapshot(INT4_MAX + 1, true)).toThrow(/too large/);
    });
  });
});
