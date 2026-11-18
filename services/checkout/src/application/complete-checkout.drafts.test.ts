import { describe, expect, it, vi } from "vitest";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { CheckoutEventTranslator } from "../infrastructure/checkout-event-translator";
import { InMemoryCheckoutLinkRepository } from "../infrastructure/in-memory-checkout-link-repository";
import { InMemoryCheckoutSessionRepository } from "../infrastructure/in-memory-checkout-session-repository";
import { InMemoryOrderCreationAdapter } from "../infrastructure/in-memory-order-creation-adapter";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { CompleteCheckout } from "./complete-checkout.use-case";
import { IssueInvoiceLink, StartDraftCheckout } from "./draft-checkout.use-cases";

const T = "tenant-a";
const DRAFT = "33333333-3333-7333-8333-333333333333";
const ADDRESS = {
  line1: "5 Nile St",
  city: "Cairo",
  postalCode: "",
  country: "EG",
  province: "EG-C",
};

async function setup(draftCompletion: { complete: ReturnType<typeof vi.fn> }) {
  const clock = { now: () => new Date("2026-10-25T10:00:00.000Z") };
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
  const links = new InMemoryCheckoutLinkRepository();
  let n = 0;
  const idGenerator = {
    generate: () => `01920000-0000-7000-8000-${(n += 1).toString().padStart(12, "0")}`,
  };
  const unitOfWork = new InMemoryUnitOfWork();
  const deps = {
    sessions,
    links,
    unitOfWork,
    idGenerator,
    clock,
    taxCalculation: { calculate: async () => ({ taxMinor: 0, included: false }) },
  };
  const started = await new StartDraftCheckout(deps).execute({
    tenantId: T,
    draftOrderRef: DRAFT,
    draftNumber: "D1",
    currency: "EGP",
    items: [
      {
        productId: "11111111-1111-7111-8111-111111111111",
        quantity: 1,
        unitPriceAmountMinor: 1000,
        currency: "EGP",
      },
    ],
    contactEmail: "sara@example.com",
    shippingAddress: ADDRESS,
    billingAddress: ADDRESS,
    shipping: { title: "Courier", amountMinor: 0 },
  });
  if (!started.ok) throw new Error(started.error.message);
  const { checkoutSessionId } = started.value;
  await new IssueInvoiceLink(deps).execute({ tenantId: T, draftOrderRef: DRAFT, createdBy: "s" });
  const complete = new CompleteCheckout({
    sessions,
    unitOfWork,
    idGenerator,
    clock,
    orderCreation: new InMemoryOrderCreationAdapter(),
    draftCompletion,
  });
  return { complete, links, checkoutSessionId };
}

describe("CompleteCheckout for a draft order's checkout (spec §4.6 decision, Ruling 11)", () => {
  it("reports the order with the actor; the invoice links stay usable (they now answer 'already placed')", async () => {
    const port = { complete: vi.fn(async () => undefined) };
    const { complete, links, checkoutSessionId } = await setup(port);
    const result = await complete.execute({
      tenantId: T,
      checkoutSessionId,
      idempotencyKey: "k",
      actorRef: "staff-1",
    });
    expect(result.ok).toBe(true);
    const orderRef = result.ok ? result.value.orderRef : "";
    expect(port.complete).toHaveBeenCalledWith({
      tenantId: T,
      draftOrderRef: DRAFT,
      orderRef,
      actorRef: "staff-1",
    });
    expect((await links.listForDraft(DRAFT, T)).every((l) => l.revokedAt === null)).toBe(true);
  });

  it("a failing report never undoes the order; a retry reports again", async () => {
    const port = {
      complete: vi
        .fn()
        .mockRejectedValueOnce(new Error("orders down"))
        .mockResolvedValue(undefined),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { complete, checkoutSessionId } = await setup(port);
    const first = await complete.execute({ tenantId: T, checkoutSessionId, idempotencyKey: "k" });
    expect(first.ok).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    const again = await complete.execute({ tenantId: T, checkoutSessionId, idempotencyKey: "k" });
    expect(again.ok && first.ok && again.value.orderRef === first.value.orderRef).toBe(true);
    expect(port.complete).toHaveBeenCalledTimes(2);
  });

  it("the shopper's completion (no actor) reports without an actorRef", async () => {
    const port = { complete: vi.fn(async (_report: object) => undefined) };
    const { complete, checkoutSessionId } = await setup(port);
    const result = await complete.execute({ tenantId: T, checkoutSessionId, idempotencyKey: "k" });
    expect(result.ok).toBe(true);
    expect(port.complete.mock.calls[0]?.[0]).not.toHaveProperty("actorRef");
  });
});
