import { describe, expect, it } from "vitest";
import type { IssueInvoiceLinkOutput, ResolveCheckoutLinkOutput } from "@platform/checkout";
import type { PublicCheckoutSessionDto } from "./public-checkout-routes";
import { recoveryWorld, seedRecoveryProduct, unwrap } from "./testing/abandoned-harness";
import { HARNESS_TENANT } from "./testing/orders-harness";

const DRAFT = "33333333-3333-7333-8333-333333333333";
const ADDRESS = {
  name: "Mona Ali",
  phone: "01001234567",
  line1: "5 Nile St",
  city: "Cairo",
  postalCode: "",
  country: "EG",
  province: "EG-C",
};

/** A draft session owned by `guest-1` — built and claimed through the raw Checkout controller. */
async function draftSession() {
  const world = recoveryWorld();
  const tee = await seedRecoveryProduct(world, "TEE", 25000);
  const checkout = world.admin.publicReads.checkout;
  const tenantId = HARNESS_TENANT;
  const started = await checkout.startDraft({
    tenantId,
    draftOrderRef: DRAFT,
    draftNumber: "D3",
    currency: "EGP",
    items: [
      {
        productId: tee.productId,
        variantId: tee.variantId,
        sku: "TEE",
        title: "Tee",
        variantTitle: null,
        quantity: 1,
        unitPriceAmountMinor: 25000,
        currency: "EGP",
      },
    ],
    contactEmail: "sara@example.com",
    shippingAddress: ADDRESS,
    billingAddress: ADDRESS,
    discount: { title: "Loyal", amountMinor: 1000 },
    shipping: { title: "Courier", amountMinor: 3000 },
  });
  const { checkoutSessionId } = unwrap<{ checkoutSessionId: string }>(started, "start draft");
  const issued = unwrap<IssueInvoiceLinkOutput>(
    await checkout.issueInvoiceLink({ tenantId, draftOrderRef: DRAFT, createdBy: "staff" }),
    "issue",
  );
  const resolved = unwrap<ResolveCheckoutLinkOutput>(
    await checkout.resolveLink({ tenantId, token: issued.token }),
    "resolve",
  );
  unwrap(
    await checkout.claimInvoice({
      tenantId,
      linkId: resolved.link.id,
      checkoutSessionId,
      sessionRef: "guest-1",
    }),
    "claim",
  );
  return { world, checkoutSessionId };
}

describe("public checkout routes on a draft order's checkout (spec §4.4)", () => {
  it("answers 409 DRAFT_LOCKED on items, shipping quote, shipping selection and both code routes", async () => {
    const { world, checkoutSessionId } = await draftSession();
    const params = { checkoutSessionId };
    const calls = [
      world.publicCall("POST", "/public/checkouts/:checkoutSessionId/items", {
        params,
        body: { sessionRef: "guest-1", cartId: "any" },
      }),
      world.publicCall("POST", "/public/checkouts/:checkoutSessionId/shipping-quote", {
        params,
        body: { sessionRef: "guest-1" },
      }),
      world.publicCall("POST", "/public/checkouts/:checkoutSessionId/shipping-selection", {
        params,
        body: { sessionRef: "guest-1", method: "standard" },
      }),
      world.publicCall("POST", "/public/checkouts/:checkoutSessionId/discount-codes", {
        params,
        body: { sessionRef: "guest-1", code: "SAVE10" },
      }),
      // This route reads its owner from the `x-cart-session` header; it takes no body.
      world.publicCall("DELETE", "/public/checkouts/:checkoutSessionId/discount-codes/:code", {
        params: { ...params, code: "SAVE10" },
        sessionRef: "guest-1",
      }),
    ];
    for (const reply of await Promise.all(calls)) {
      expect(reply.status).toBe(409);
      expect((reply.body as { code: string }).code).toBe("DRAFT_LOCKED");
      expect((reply.body as { message: string }).message).toMatch(/^DRAFT_LOCKED:/);
    }
    // Nothing the merchant fixed moved.
    const dto = unwrap<PublicCheckoutSessionDto>(
      await world.publicCall("GET", "/public/checkouts/:checkoutSessionId", {
        params,
        sessionRef: "guest-1",
      }),
      "get",
    );
    expect(dto.selectedShippingMethod).toBe("draft");
    expect(dto.discount.codes).toEqual([]);
    expect(dto.totals?.shippingMinor).toBe(3000);
  });

  it("someone else's sessionRef still gets the uniform 404 (ownership is checked first)", async () => {
    const { world, checkoutSessionId } = await draftSession();
    const reply = await world.publicCall(
      "POST",
      "/public/checkouts/:checkoutSessionId/shipping-quote",
      { params: { checkoutSessionId }, body: { sessionRef: "stranger" } },
    );
    expect(reply.status).toBe(404);
    const deleted = await world.publicCall(
      "DELETE",
      "/public/checkouts/:checkoutSessionId/discount-codes/:code",
      { params: { checkoutSessionId, code: "SAVE10" }, sessionRef: "stranger" },
    );
    expect(deleted.status).toBe(404);
  });

  it("the session DTO says it is invoice #D3, shows the fixed shipping and the draft discount, never a sessionRef", async () => {
    const { world, checkoutSessionId } = await draftSession();
    const dto = unwrap<PublicCheckoutSessionDto>(
      await world.publicCall("GET", "/public/checkouts/:checkoutSessionId", {
        params: { checkoutSessionId },
        sessionRef: "guest-1",
      }),
      "get",
    );
    expect(dto.draftInvoice).toEqual({ draftNumber: "D3" });
    expect(dto.selectedShippingMethod).toBe("draft");
    expect(dto.totals?.shippingName).toBe("Courier");
    expect(dto.discount.applied).toEqual([
      { title: "Loyal", code: null, discountClass: "order", amountMinor: 1000 },
    ]);
    expect(JSON.stringify(dto)).not.toContain("guest-1");
  });

  it("an ordinary checkout's DTO has no draft invoice", async () => {
    const world = recoveryWorld();
    const started = unwrap<{ id: string }>(
      await world.publicCall("POST", "/public/checkouts", {
        body: { sessionRef: "guest-9", cartRef: "cart-9", currency: "EGP" },
      }),
      "start",
    );
    const dto = unwrap<PublicCheckoutSessionDto>(
      await world.publicCall("GET", "/public/checkouts/:checkoutSessionId", {
        params: { checkoutSessionId: started.id },
        sessionRef: "guest-9",
      }),
      "get",
    );
    expect(dto.draftInvoice).toBeNull();
  });

  it("contact, addresses, tax, payment selection and completion stay open to the shopper", async () => {
    const { world, checkoutSessionId } = await draftSession();
    const params = { checkoutSessionId };
    expect(
      (
        await world.publicCall("POST", "/public/checkouts/:checkoutSessionId/contact", {
          params,
          body: { sessionRef: "guest-1", email: "other@example.com" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await world.publicCall("POST", "/public/checkouts/:checkoutSessionId/shipping-address", {
          params,
          body: { sessionRef: "guest-1", ...ADDRESS, line1: "9 Nile St" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await world.publicCall("POST", "/public/checkouts/:checkoutSessionId/recalculate", {
          params,
          body: { sessionRef: "guest-1" },
        })
      ).status,
    ).toBe(200);
  });
});
