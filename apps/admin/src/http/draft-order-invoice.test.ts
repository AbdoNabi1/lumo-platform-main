import { describe, expect, it, vi } from "vitest";
import type { CheckoutSession } from "@platform/checkout";
import type { DraftOrder } from "@platform/orders";
import { logger } from "@platform/utils";
import type { RecoveryLinkDto } from "./abandoned-checkout-dto";
import type { DraftOrderDto } from "./draft-order-dto";
import type { CheckoutLinkClaimDto, CheckoutLinkPreviewDto } from "./public-checkout-link-routes";
import type { PublicCheckoutSessionDto } from "./public-checkout-routes";
import { abandonCheckout, completeCheckout, HOUR_MS, unwrap } from "./testing/abandoned-harness";
import {
  createDraft,
  draftBody,
  draftWorld,
  enableCashOnDelivery,
  type DraftWorld,
} from "./testing/draft-harness";
import { HARNESS_TENANT, operatorStaff, viewerStaff } from "./testing/orders-harness";

interface InvoiceLink {
  url: string | null;
  path: string;
  expiresAt: string;
  shopName: string;
}

const send = (world: DraftWorld, draftId: string, principal = operatorStaff) =>
  world.staffCall(
    "POST",
    "/draft-orders/:draftId/invoice-link",
    { params: { draftId } },
    principal,
  );
const tokenOf = (link: InvoiceLink) => link.path.slice("/c/".length);
const sendToken = async (world: DraftWorld, draftId: string) =>
  tokenOf(unwrap<InvoiceLink>(await send(world, draftId), "send"));
const claim = (world: DraftWorld, token: string, sessionRef: string) =>
  world.publicCall("POST", "/public/checkout-links/claim", { body: { token, sessionRef } });
const preview = (world: DraftWorld, token: string) =>
  world.publicCall("GET", "/public/checkout-links/:token/preview", { params: { token } });
const sessionAs = (world: DraftWorld, checkoutSessionId: string, sessionRef: string) =>
  world.publicCall("GET", "/public/checkouts/:checkoutSessionId", {
    params: { checkoutSessionId },
    sessionRef,
  });
const detail = async (world: DraftWorld, draftId: string) =>
  unwrap<DraftOrderDto>(
    await world.staffCall("GET", "/draft-orders/:draftId", { params: { draftId } }, viewerStaff),
    "detail",
  );
/** Checkout's own state of a session, read past the ownership check (`started`, `expired`, …). */
const stateOf = async (world: DraftWorld, checkoutSessionId: string) =>
  unwrap<CheckoutSession>(
    await world.admin.publicReads.checkout.get({ tenantId: HARNESS_TENANT, checkoutSessionId }),
    "session",
  ).state.value;
const cartOf = async (world: DraftWorld, sessionRef: string) =>
  unwrap<{ cart: unknown }>(
    await world.publicCall("GET", "/public/carts/current", { sessionRef }),
    "current cart",
  ).cart;

describe("POST /draft-orders/:draftId/invoice-link (spec §4.7)", () => {
  it("issues a 30-day link at /c/<token>, marks the draft Invoice sent and lists the link", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const link = unwrap<InvoiceLink>(await send(world, draft.id), "send");
    expect(link.path).toMatch(/^\/c\/[A-Za-z0-9_-]{43}$/);
    expect(link.url).toBeNull(); // no verified domain in the harness → admin-web uses STOREFRONT_URL
    expect(Date.parse(link.expiresAt) - world.clock.now().getTime()).toBe(30 * 24 * 3_600_000);
    const after = await detail(world, draft.id);
    expect(after.status).toBe("invoice_sent");
    expect(after.links).toHaveLength(1);
    const again = unwrap<InvoiceLink>(await send(world, draft.id), "send again");
    expect(again.path).not.toBe(link.path);
    expect((await preview(world, tokenOf(link))).status).toBe(200);
  });

  it("is NOT idempotent: the response cache would keep the plaintext token (binding carry 2)", async () => {
    const world = await draftWorld();
    const route = world.routes.find(
      (r) => r.method === "POST" && r.path === "/draft-orders/:draftId/invoice-link",
    );
    expect(route).toBeDefined();
    expect(route?.idempotent).not.toBe(true);
  });

  it("refuses a draft that is not ready (422 with what is missing) and viewers (403)", async () => {
    const world = await draftWorld();
    const bare = await createDraft(world, { shipping: null });
    const refused = await send(world, bare.id);
    expect(refused.status).toBe(422);
    expect((refused.body as { fields: { field: string }[] }).fields.map((f) => f.field)).toEqual([
      "shipping",
    ]);
    expect((await send(world, bare.id, viewerStaff)).status).toBe(403);
    expect((await detail(world, bare.id)).links).toEqual([]);
  });
});

describe("the invoice landing page's API (spec §4.7, §3.5)", () => {
  it("previews 'Invoice #D1' with items and the total — no email, phone or address", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const token = await sendToken(world, draft.id);
    const dto = unwrap<CheckoutLinkPreviewDto>(await preview(world, token), "preview");
    expect(dto).toMatchObject({
      purpose: "invoice",
      draftNumber: "D1",
      completed: false,
      itemCount: 3,
      currency: "EGP",
    });
    expect(Object.keys(dto).sort()).toEqual([
      "completed",
      "currency",
      "draftNumber",
      "itemCount",
      "items",
      "purpose",
      "shopName",
      "totalMinor",
    ]);
    expect(dto.totalMinor).toBe(draft.totals.totalMinor);
    const text = JSON.stringify(dto);
    for (const secret of ["sara@example.com", "01001234567", "Nile", "Mona", "tokenHash", draft.id])
      expect(text).not.toContain(secret);
  });

  it("the claim hands the draft's checkout to the opener; the last opener owns it", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const token = await sendToken(world, draft.id);
    const first = unwrap<CheckoutLinkClaimDto>(await claim(world, token, "guest-a"), "claim a");
    expect(first.droppedItems).toBe(0);
    const mine = unwrap<PublicCheckoutSessionDto>(
      await sessionAs(world, first.checkoutSessionId, "guest-a"),
      "session",
    );
    expect(mine.draftInvoice).toEqual({ draftNumber: "D1" });
    expect(mine.totals?.grandTotalMinor).toBe(draft.totals.totalMinor);
    const second = unwrap<CheckoutLinkClaimDto>(await claim(world, token, "guest-b"), "claim b");
    expect(second.checkoutSessionId).toBe(first.checkoutSessionId); // reused: the draft did not change
    expect((await sessionAs(world, first.checkoutSessionId, "guest-a")).status).toBe(404);
    expect((await sessionAs(world, first.checkoutSessionId, "guest-b")).status).toBe(200);
  });

  it("a later opener takes over even a locked checkout (Ruling 22: the last opener owns)", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const token = await sendToken(world, draft.id);
    const first = unwrap<CheckoutLinkClaimDto>(await claim(world, token, "guest-a"), "claim a");
    unwrap(
      await world.admin.publicReads.checkout.lock({
        tenantId: HARNESS_TENANT,
        checkoutSessionId: first.checkoutSessionId,
      }),
      "lock",
    );
    expect(await stateOf(world, first.checkoutSessionId)).toBe("locked");
    const second = unwrap<CheckoutLinkClaimDto>(await claim(world, token, "guest-b"), "claim b");
    expect(second.checkoutSessionId).toBe(first.checkoutSessionId);
    expect((await sessionAs(world, first.checkoutSessionId, "guest-a")).status).toBe(404);
    expect((await sessionAs(world, first.checkoutSessionId, "guest-b")).status).toBe(200);
  });

  it("an invoice token opens the draft's checkout — never a recovery clone of a cart", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const token = await sendToken(world, draft.id);
    const claimed = unwrap<CheckoutLinkClaimDto>(await claim(world, token, "guest-a"), "claim");
    expect(await cartOf(world, "guest-a")).toBeNull();
    const session = unwrap<PublicCheckoutSessionDto>(
      await sessionAs(world, claimed.checkoutSessionId, "guest-a"),
      "session",
    );
    expect(session.draftInvoice).toEqual({ draftNumber: "D1" });
  });

  it("a recovery token on the same shop never opens a draft's invoice checkout", async () => {
    const world = await draftWorld();
    await createDraft(world);
    const abandoned = await abandonCheckout(world, {
      sessionRef: "guest-original",
      lines: [{ product: world.tee, quantity: 1 }],
      email: "sara@example.com",
    });
    world.clock.advance(2 * HOUR_MS);
    const link = unwrap<RecoveryLinkDto>(
      await world.staffCall(
        "POST",
        "/abandoned-checkouts/:checkoutSessionId/recovery-link",
        { params: { checkoutSessionId: abandoned.checkoutSessionId } },
        operatorStaff,
      ),
      "recovery link",
    );
    const token = link.path.slice("/c/".length);
    const dto = unwrap<CheckoutLinkPreviewDto>(await preview(world, token), "preview");
    expect(dto).toMatchObject({ purpose: "recovery", draftNumber: null, completed: false });
    const claimed = unwrap<CheckoutLinkClaimDto>(await claim(world, token, "guest-b"), "claim");
    const session = unwrap<PublicCheckoutSessionDto>(
      await sessionAs(world, claimed.checkoutSessionId, "guest-b"),
      "session",
    );
    expect(session.draftInvoice).toBeNull();
  });

  it("an edit expires the open invoice checkout; the link re-opens at the new total (Ruling 4)", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const token = await sendToken(world, draft.id);
    const before = unwrap<CheckoutLinkClaimDto>(await claim(world, token, "guest-a"), "claim");
    const edited = unwrap<DraftOrderDto>(
      await world.staffCall(
        "PUT",
        "/draft-orders/:draftId",
        {
          params: { draftId: draft.id },
          body: { ...draftBody(world, { discount: null }), version: draft.version },
        },
        operatorStaff,
      ),
      "edit",
    );
    expect(await stateOf(world, before.checkoutSessionId)).toBe("expired");
    const stale = await world.publicCall("POST", "/public/checkouts/:checkoutSessionId/complete", {
      params: { checkoutSessionId: before.checkoutSessionId },
      body: { sessionRef: "guest-a", idempotencyKey: "k-stale" },
    });
    expect(stale.status).not.toBe(200);
    const after = unwrap<CheckoutLinkClaimDto>(await claim(world, token, "guest-a"), "claim again");
    expect(after.checkoutSessionId).not.toBe(before.checkoutSessionId);
    const session = unwrap<PublicCheckoutSessionDto>(
      await sessionAs(world, after.checkoutSessionId, "guest-a"),
      "session",
    );
    expect(session.totals?.grandTotalMinor).toBe(edited.totals.totalMinor);
    expect(edited.totals.totalMinor).not.toBe(draft.totals.totalMinor);
  });

  it("paying through the link completes the draft; reopening says it was already placed", async () => {
    const world = await draftWorld();
    await enableCashOnDelivery(world);
    const draft = await createDraft(world);
    const token = await sendToken(world, draft.id);
    const claimed = unwrap<CheckoutLinkClaimDto>(await claim(world, token, "guest-a"), "claim");
    const orderRef = await completeCheckout(world, claimed.checkoutSessionId, "guest-a");
    const completed = await detail(world, draft.id);
    expect(completed.status).toBe("completed");
    expect(completed.order?.id).toBe(orderRef);
    const again = await claim(world, token, "guest-a");
    expect(again.status).toBe(409);
    expect((again.body as { code: string }).code).toBe("ALREADY_COMPLETED");
    expect(unwrap<CheckoutLinkPreviewDto>(await preview(world, token), "preview").completed).toBe(
      true,
    );
    const resend = await send(world, draft.id);
    expect(resend.status).toBe(409);
    expect((resend.body as { code: string }).code).toBe("DRAFT_COMPLETED");
  });

  it("a link payment the port could not report is healed when the draft is read (Ruling 10)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    try {
      const world = await draftWorld({
        draftCompletion: { complete: () => Promise.reject(new Error("Orders is unreachable")) },
      });
      await enableCashOnDelivery(world);
      const draft = await createDraft(world);
      const token = await sendToken(world, draft.id);
      const claimed = unwrap<CheckoutLinkClaimDto>(await claim(world, token, "guest-a"), "claim");
      const orderRef = await completeCheckout(world, claimed.checkoutSessionId, "guest-a");
      expect(warn).toHaveBeenCalledWith(
        "could not record a draft order's completion",
        expect.objectContaining({ error: "Orders is unreachable" }),
      );
      const stored = unwrap<DraftOrder>(
        await world.admin.publicReads.draftOrders.getDraftOrder({
          tenantId: HARNESS_TENANT,
          draftId: draft.id,
        }),
        "stored draft",
      );
      expect(stored.status).toBe("invoice_sent"); // the port's report never arrived
      const healed = await detail(world, draft.id);
      expect(healed.status).toBe("completed");
      expect(healed.order?.id).toBe(orderRef);
    } finally {
      warn.mockRestore();
    }
  });

  it("a deleted draft's (revoked) link answers the SAME 404 LINK_INVALID as an unknown token (binding carry 3)", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const token = await sendToken(world, draft.id);
    const claimed = unwrap<CheckoutLinkClaimDto>(await claim(world, token, "guest-a"), "claim");
    const unknown = await claim(world, "x".repeat(43), "guest-a");
    expect(
      (
        await world.staffCall(
          "DELETE",
          "/draft-orders/:draftId",
          { params: { draftId: draft.id } },
          operatorStaff,
        )
      ).status,
    ).toBe(200);
    // Ruling 17: the links are revoked AND the open checkout is stopped.
    expect(await stateOf(world, claimed.checkoutSessionId)).toBe("expired");
    for (const reply of [await claim(world, token, "guest-a"), await preview(world, token)]) {
      expect(reply.status).toBe(404);
      expect(reply.body).toEqual(unknown.body);
      expect((reply.body as { code: string }).code).toBe("LINK_INVALID");
    }
  });

  it("another shop's token is unknown", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const token = await sendToken(world, draft.id);
    const other = await world.publicCall("POST", "/public/checkout-links/claim", {
      body: { token, sessionRef: "g" },
      tenantId: "shop-b",
    });
    expect(other.status).toBe(404);
  });
});
