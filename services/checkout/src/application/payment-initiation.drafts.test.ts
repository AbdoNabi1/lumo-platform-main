import { describe, expect, it, vi } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { CheckoutSession } from "../domain/checkout-session";
import { PaymentSelection } from "../domain/value-objects/selections";
import { CheckoutEventTranslator } from "../infrastructure/checkout-event-translator";
import { InMemoryCheckoutLinkRepository } from "../infrastructure/in-memory-checkout-link-repository";
import { InMemoryCheckoutSessionRepository } from "../infrastructure/in-memory-checkout-session-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { SelectDraftPayment, StartDraftCheckout } from "./draft-checkout.use-cases";
import { InitiatePayment } from "./payment-initiation.use-cases";
import type { PaymentInitiationPort } from "./ports";

/**
 * Order operations Part 4, Ruling 8 (deny by default): only a DRAFT order's checkout may ask Payments to
 * open a staff-recorded (`manual`) payment, and that fact comes from the session itself — never from a
 * request.
 */
const T = "tenant-a";
const NOW = new Date("2026-10-25T10:00:00.000Z");
const ADDRESS = {
  name: "Mona Ali",
  phone: "01001234567",
  line1: "5 Nile St",
  city: "Cairo",
  postalCode: "",
  country: "EG",
  province: "EG-C",
};

function world() {
  const clock = { now: () => NOW };
  const sessions = new InMemoryCheckoutSessionRepository({
    outbox: new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new CheckoutEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "checkout",
    }),
    context: rootEventContext({ generate: () => "evt" }),
    clock,
  });
  let n = 0;
  const unitOfWork = new InMemoryUnitOfWork();
  const deps = {
    sessions,
    links: new InMemoryCheckoutLinkRepository(),
    unitOfWork,
    idGenerator: {
      generate: () => `01920000-0000-7000-8000-${(n += 1).toString().padStart(12, "0")}`,
    },
    clock,
    taxCalculation: { calculate: () => Promise.resolve({ taxMinor: 0, included: false }) },
    abandoned: sessions,
  };
  const initiate = vi.fn<PaymentInitiationPort["initiate"]>().mockImplementation((input) =>
    Promise.resolve({
      paymentIntentId: "pi-1",
      status: "created",
      provider: input.provider,
    }),
  );
  return {
    sessions,
    initiate,
    startDraft: new StartDraftCheckout(deps),
    selectDraftPayment: new SelectDraftPayment(deps),
    initiatePayment: new InitiatePayment({
      sessions,
      unitOfWork,
      paymentInitiation: { initiate },
    }),
  };
}

async function draftSession(w: ReturnType<typeof world>): Promise<string> {
  const started = await w.startDraft.execute({
    tenantId: T,
    draftOrderRef: "33333333-3333-7333-8333-333333333333",
    draftNumber: "D1",
    currency: "EGP",
    items: [
      {
        productId: "11111111-1111-7111-8111-111111111111",
        variantId: "v-1",
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
    shipping: { title: "Courier", amountMinor: 4000 },
  });
  if (!started.ok) throw new Error(started.error.message);
  const id = started.value.checkoutSessionId;
  const paid = await w.selectDraftPayment.execute({
    tenantId: T,
    checkoutSessionId: id,
    provider: "manual",
  });
  if (!paid.ok) throw new Error(paid.error.message);
  await complete(w, id);
  return id;
}

/** A shopper's own checkout that somehow carries a `manual` selection (it cannot through the routes). */
async function shopperSessionWithManual(w: ReturnType<typeof world>): Promise<string> {
  const borrowed = await draftSession(w); // only to borrow a valid set of priced lines
  const items = (await w.sessions.findById(borrowed, T))?.items ?? [];
  const id = "01920000-0000-7000-8000-0000000000aa";
  const session = CheckoutSession.start(
    UniqueEntityId.from(id),
    "cart-1",
    undefined,
    "guest-1",
    "EGP",
  );
  const selection = PaymentSelection.create("manual", "manual");
  if (!selection.ok) throw new Error(selection.error.message);
  session.loadItems(items);
  session.recalculateTotals("evt-totals", NOW);
  session.selectPayment(selection.value);
  await w.sessions.save(session, T);
  await complete(w, id);
  return id;
}

async function complete(w: ReturnType<typeof world>, id: string): Promise<void> {
  const session = await w.sessions.findById(id, T);
  if (session === null) throw new Error("no session");
  session.complete("order-1", "evt-complete", NOW);
  await w.sessions.save(session, T);
}

describe("InitiatePayment and staff-recorded payments (Ruling 8, deny by default)", () => {
  it("tells the port a DRAFT session may open a staff-recorded payment when STAFF initiate it", async () => {
    const w = world();
    const id = await draftSession(w);
    const opened = await w.initiatePayment.execute({
      tenantId: T,
      checkoutSessionId: id,
      initiatedByStaff: true,
    });
    expect(opened.ok).toBe(true);
    expect(w.initiate).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "manual", allowStaffRecorded: true }),
    );
  });

  it("never lets a shopper open one on a draft session, even with manual selected (Task 7 I-2)", async () => {
    const w = world();
    const id = await draftSession(w);
    await w.initiatePayment.execute({
      tenantId: T,
      checkoutSessionId: id,
      initiatedByStaff: false,
    });
    expect(w.initiate).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "manual", allowStaffRecorded: false }),
    );
  });

  it("never lets a shopper's own (non-draft) session open one, even if manual was somehow selected", async () => {
    const w = world();
    const id = await shopperSessionWithManual(w);
    // Even a staff caller: only a DRAFT session may carry a staff-recorded payment.
    await w.initiatePayment.execute({ tenantId: T, checkoutSessionId: id, initiatedByStaff: true });
    expect(w.initiate).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "manual", allowStaffRecorded: false }),
    );
  });
});
