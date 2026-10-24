import { describe, expect, it } from "vitest";
import type {
  AbandonedCheckoutDetailDto,
  AbandonedCheckoutListItemDto,
  RecoveryLinkDto,
} from "./abandoned-checkout-dto";
import type { CheckoutLinkPreviewDto } from "./public-checkout-link-routes";
import type { PublicCheckoutSessionDto } from "./public-checkout-routes";
import {
  abandonCheckout,
  completeCheckout,
  HOUR_MS,
  recoveryWorld,
  seedRecoveryProduct,
  unwrap,
  type RecoveryWorld,
} from "./testing/abandoned-harness";
import { HARNESS_TENANT, operatorStaff, viewerStaff } from "./testing/orders-harness";

const ORIGINAL_REF = "guest-original-ref";
const OPENER_REF = "guest-opener-ref";

async function setup() {
  const world = recoveryWorld();
  const tee = await seedRecoveryProduct(world, "TEE", 25000);
  const cap = await seedRecoveryProduct(world, "CAP", 9000);
  const mug = await seedRecoveryProduct(world, "MUG", 5000);
  const { checkoutSessionId } = await abandonCheckout(world, {
    sessionRef: ORIGINAL_REF,
    lines: [
      { product: tee, quantity: 2 },
      { product: cap, quantity: 1 },
    ],
    email: "sara@example.com",
  });
  world.clock.advance(2 * HOUR_MS);
  const link = unwrap<RecoveryLinkDto>(
    await world.staffCall(
      "POST",
      "/abandoned-checkouts/:checkoutSessionId/recovery-link",
      { params: { checkoutSessionId } },
      operatorStaff,
    ),
    "issue link",
  );
  return { world, tee, cap, mug, checkoutSessionId, token: link.path.slice("/c/".length) };
}

const claim = (world: RecoveryWorld, token: string, sessionRef: string, tenantId?: string) =>
  world.publicCall("POST", "/public/checkout-links/claim", {
    body: { token, sessionRef },
    ...(tenantId === undefined ? {} : { tenantId }),
  });
const preview = (world: RecoveryWorld, token: string, tenantId?: string) =>
  world.publicCall("GET", "/public/checkout-links/:token/preview", {
    params: { token },
    ...(tenantId === undefined ? {} : { tenantId }),
  });
const sessionAs = (world: RecoveryWorld, checkoutSessionId: string, sessionRef: string) =>
  world.publicCall("GET", "/public/checkouts/:checkoutSessionId", {
    params: { checkoutSessionId },
    sessionRef,
  });
const cartOf = async (world: RecoveryWorld, sessionRef: string) =>
  unwrap<{ cart: { items: { productId: string; quantity: number }[] } | null }>(
    await world.publicCall("GET", "/public/carts/current", { sessionRef }),
    "current cart",
  ).cart;
const linksOf = async (world: RecoveryWorld, checkoutSessionId: string) =>
  unwrap<AbandonedCheckoutDetailDto>(
    await world.staffCall(
      "GET",
      "/abandoned-checkouts/:checkoutSessionId",
      { params: { checkoutSessionId } },
      viewerStaff,
    ),
    "detail",
  ).links;

interface Claimed {
  readonly checkoutSessionId: string;
  readonly droppedItems: number;
}

describe("POST /public/checkout-links/claim (order operations Part 3)", () => {
  it("clones the lines into the opener's OWN new checkout at today's prices, with contact and address", async () => {
    const { world, tee, checkoutSessionId, token } = await setup();
    unwrap(
      await world.admin.publicReads.products.updateVariant({
        productId: tee.productId,
        variantId: tee.variantId,
        sku: "TEE-STD",
        priceAmountMinor: 27000,
        currency: "EGP",
        tenantId: HARNESS_TENANT,
      }),
      "reprice",
    );

    const reply = await claim(world, token, OPENER_REF);
    expect(reply.status).toBe(200);
    const claimed = reply.body as Claimed;
    expect(Object.keys(claimed).sort()).toEqual(["checkoutSessionId", "droppedItems"]);
    expect(claimed.droppedItems).toBe(0);
    expect(claimed.checkoutSessionId).not.toBe(checkoutSessionId);
    expect(JSON.stringify(reply.body)).not.toContain(ORIGINAL_REF);

    const clone = unwrap<PublicCheckoutSessionDto>(
      await sessionAs(world, claimed.checkoutSessionId, OPENER_REF),
      "read clone",
    );
    expect(clone.items.map((item) => [item.sku, item.quantity, item.unitPriceAmountMinor])).toEqual(
      [
        ["TEE-STD", 2, 27000],
        ["CAP-STD", 1, 9000],
      ],
    );
    expect(clone.contactEmail).toBe("sara@example.com");
    expect(clone.shippingAddress).toMatchObject({
      name: "Mona Ali",
      phone: "01001234567",
      city: "Cairo",
      province: "EG-C",
    });
    expect(clone.selectedShippingMethod).toBeNull();
    expect(clone.selectedPaymentMethod).toBeNull();
    expect(clone.discount.codes).toEqual([]);

    // Ownership never moves: the original's owner cannot read the clone, the opener cannot read the original.
    expect((await sessionAs(world, claimed.checkoutSessionId, ORIGINAL_REF)).status).toBe(404);
    expect((await sessionAs(world, checkoutSessionId, OPENER_REF)).status).toBe(404);
    expect((await linksOf(world, checkoutSessionId))[0]?.claimCount).toBe(1);
  });

  it("replaces whatever the opener already had in their cart", async () => {
    const { world, tee, cap, mug, token } = await setup();
    const cart = unwrap<{ id: string }>(
      await world.publicCall("POST", "/public/carts", {
        body: { sessionRef: OPENER_REF, currency: "EGP" },
      }),
      "opener cart",
    );
    unwrap(
      await world.publicCall("POST", "/public/carts/:cartId/items", {
        params: { cartId: cart.id },
        body: { sessionRef: OPENER_REF, productId: mug.productId, quantity: 5 },
      }),
      "opener item",
    );
    unwrap(await claim(world, token, OPENER_REF), "claim");
    expect((await cartOf(world, OPENER_REF))?.items.map((i) => [i.productId, i.quantity])).toEqual([
      [tee.productId, 2],
      [cap.productId, 1],
    ]);
  });

  it("drops lines that can no longer be sold and says how many", async () => {
    const { world, tee, cap, token } = await setup();
    unwrap(
      await world.admin.publicReads.products.unpublish({
        productId: cap.productId,
        tenantId: HARNESS_TENANT,
      }),
      "unpublish",
    );
    const claimed = unwrap<Claimed>(await claim(world, token, OPENER_REF), "claim");
    expect(claimed.droppedItems).toBe(1);
    const clone = unwrap<PublicCheckoutSessionDto>(
      await sessionAs(world, claimed.checkoutSessionId, OPENER_REF),
      "read clone",
    );
    expect(clone.items.map((item) => item.productId)).toEqual([tee.productId]);
  });

  it("nothing left to sell → 409 ITEMS_UNAVAILABLE, and the opener's cart is left as it was", async () => {
    const { world, tee, cap, mug, checkoutSessionId, token } = await setup();
    const cart = unwrap<{ id: string }>(
      await world.publicCall("POST", "/public/carts", {
        body: { sessionRef: OPENER_REF, currency: "EGP" },
      }),
      "opener cart",
    );
    unwrap(
      await world.publicCall("POST", "/public/carts/:cartId/items", {
        params: { cartId: cart.id },
        body: { sessionRef: OPENER_REF, productId: mug.productId, quantity: 1 },
      }),
      "opener item",
    );
    for (const product of [tee, cap]) {
      unwrap(
        await world.admin.publicReads.products.unpublish({
          productId: product.productId,
          tenantId: HARNESS_TENANT,
        }),
        "unpublish",
      );
    }
    const reply = await claim(world, token, OPENER_REF);
    expect(reply.status).toBe(409);
    expect((reply.body as { code: string }).code).toBe("ITEMS_UNAVAILABLE");
    expect((await cartOf(world, OPENER_REF))?.items.map((i) => [i.productId, i.quantity])).toEqual([
      [mug.productId, 1],
    ]);
    expect((await linksOf(world, checkoutSessionId))[0]?.claimCount).toBe(0);
  });

  it("a second tap by the same shopper resumes the same checkout instead of cloning again", async () => {
    const { world, checkoutSessionId, token } = await setup();
    const first = unwrap<Claimed>(await claim(world, token, OPENER_REF), "first tap");
    const second = unwrap<Claimed>(await claim(world, token, OPENER_REF), "second tap");
    expect(second).toEqual({ checkoutSessionId: first.checkoutSessionId, droppedItems: 0 });
    expect((await linksOf(world, checkoutSessionId))[0]?.claimCount).toBe(1);
  });

  it("another shopper's tap clones their own checkout", async () => {
    const { world, token } = await setup();
    const mine = unwrap<Claimed>(await claim(world, token, OPENER_REF), "mine");
    const theirs = unwrap<Claimed>(await claim(world, token, "guest-forwarded-to"), "theirs");
    expect(theirs.checkoutSessionId).not.toBe(mine.checkoutSessionId);
    expect((await sessionAs(world, theirs.checkoutSessionId, OPENER_REF)).status).toBe(404);
  });

  it("unknown, expired and other-shop tokens all answer the same 404 LINK_INVALID", async () => {
    const { world, token } = await setup();
    const unknown = await claim(world, "x".repeat(43), OPENER_REF);
    const otherShop = await claim(world, token, OPENER_REF, "shop-b");
    world.clock.advance(7 * 24 * HOUR_MS);
    const expired = await claim(world, token, OPENER_REF);
    for (const reply of [unknown, otherShop, expired]) {
      expect(reply.status).toBe(404);
      expect(reply.body).toEqual(unknown.body);
    }
    expect((unknown.body as { code: string }).code).toBe("LINK_INVALID");
  });

  it("a link whose checkout became an order is spent; the original browser cannot place it either (Review Focus 4)", async () => {
    const { world, checkoutSessionId, token } = await setup();
    const claimed = unwrap<Claimed>(await claim(world, token, OPENER_REF), "claim");
    const orderRef = await completeCheckout(world, claimed.checkoutSessionId, OPENER_REF);

    const again = await claim(world, token, "guest-forwarded-to");
    expect(again.status).toBe(404);
    expect((again.body as { code: string }).code).toBe("LINK_INVALID");

    const originalComplete = await world.publicCall(
      "POST",
      "/public/checkouts/:checkoutSessionId/complete",
      {
        params: { checkoutSessionId },
        body: { sessionRef: ORIGINAL_REF, idempotencyKey: "original-try" },
      },
    );
    expect(originalComplete.status).toBe(409);

    const row = unwrap<{ items: AbandonedCheckoutListItemDto[] }>(
      await world.staffCall(
        "GET",
        "/abandoned-checkouts",
        { query: { recovery: "recovered" } },
        viewerStaff,
      ),
      "list",
    ).items[0];
    expect(row?.id).toBe(checkoutSessionId);
    expect(row?.recoveryStatus).toBe("recovered");
    expect(row?.recoveredOrder?.id).toBe(orderRef);
    expect(typeof row?.recoveredOrder?.orderNumber).toBe("string");
  });

  it("is public, takes only { token, sessionRef }, and the public start cannot set recoveredFromRef", async () => {
    const { world } = await setup();
    const route = world.routes.find(
      (r) => r.method === "POST" && r.path === "/public/checkout-links/claim",
    );
    expect(route?.public).toBe(true);
    expect(route?.permission).toBe("checkout:start");
    expect(route?.schema.body?.safeParse({ token: "t", sessionRef: "s" }).success).toBe(true);
    expect(
      route?.schema.body?.safeParse({ token: "t", sessionRef: "s", priceMinor: 1 }).success,
    ).toBe(false);
    expect(route?.schema.body?.safeParse({ token: "t" }).success).toBe(false);
    const start = world.routes.find((r) => r.method === "POST" && r.path === "/public/checkouts");
    expect(
      start?.schema.body?.safeParse({
        sessionRef: "s",
        cartRef: "c",
        currency: "EGP",
        recoveredFromRef: "x",
      }).success,
    ).toBe(false);
  });
});

describe("GET /public/checkout-links/:token/preview", () => {
  it("shows the shop, the items and the total — never an email, phone, address or sessionRef", async () => {
    const { world, token } = await setup();
    const reply = await preview(world, token);
    expect(reply.status).toBe(200);
    const dto = reply.body as CheckoutLinkPreviewDto;
    expect(Object.keys(dto).sort()).toEqual([
      "currency",
      "itemCount",
      "items",
      "purpose",
      "shopName",
      "totalMinor",
    ]);
    expect(dto.purpose).toBe("recovery");
    expect(dto.itemCount).toBe(3);
    expect(dto.totalMinor).toBe(59000);
    expect(dto.currency).toBe("EGP");
    expect(dto.items.map((item) => Object.keys(item).sort())).toEqual([
      ["imageUrl", "quantity", "title", "variantTitle"],
      ["imageUrl", "quantity", "title", "variantTitle"],
    ]);
    const text = JSON.stringify(dto);
    for (const secret of ["sara@", "0100", "Nile", "Mona", "Cairo", ORIGINAL_REF]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("reading it never claims: no clone, no cart, no claim counted", async () => {
    const { world, checkoutSessionId, token } = await setup();
    await preview(world, token);
    await preview(world, token);
    expect((await linksOf(world, checkoutSessionId))[0]?.claimCount).toBe(0);
    expect(await cartOf(world, OPENER_REF)).toBeNull();
  });

  it("an invalid token answers exactly what the claim answers", async () => {
    const { world, token } = await setup();
    const fromPreview = await preview(world, token, "shop-b");
    const fromClaim = await claim(world, "x".repeat(43), OPENER_REF);
    expect(fromPreview.status).toBe(404);
    expect(fromPreview.body).toEqual(fromClaim.body);
  });
});
