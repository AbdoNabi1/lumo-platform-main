import { describe, expect, it, vi } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import type { Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { CheckoutLink, RECOVERY_LINK_TTL_MS } from "../domain/checkout-link";
import { CheckoutSession } from "../domain/checkout-session";
import { CheckoutEventTranslator } from "../infrastructure/checkout-event-translator";
import { InMemoryCheckoutLinkRepository } from "../infrastructure/in-memory-checkout-link-repository";
import { InMemoryCheckoutSessionRepository } from "../infrastructure/in-memory-checkout-session-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { ResolveCheckoutLink } from "./abandoned-checkouts.use-cases";
import { checkoutAddressProblem, validCheckoutAddress } from "./address-province";
import {
  ClaimInvoiceCheckout,
  IssueInvoiceLink,
  RevokeDraftLinks,
  SelectDraftPayment,
  StartDraftCheckout,
  type StartDraftCheckoutInput,
} from "./draft-checkout.use-cases";

const T = "tenant-a";
const DRAFT = "33333333-3333-7333-8333-333333333333";
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

const value = <T>(r: Result<T, DomainError>): T => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
};
const failure = <T>(r: Result<T, DomainError>): DomainError => {
  if (r.ok) throw new Error("expected a failure");
  return r.error;
};

function world() {
  let now = NOW;
  const clock = { now: () => now };
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
  const taxCalculation = { calculate: async () => ({ taxMinor: 700, included: false }) };
  const deps = {
    sessions,
    links,
    unitOfWork,
    idGenerator,
    clock,
    taxCalculation,
    abandoned: sessions,
  };
  return {
    sessions,
    links,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    start: new StartDraftCheckout(deps),
    pay: new SelectDraftPayment(deps),
    issue: new IssueInvoiceLink(deps),
    claim: new ClaimInvoiceCheckout(deps),
    revoke: new RevokeDraftLinks(deps),
    resolve: new ResolveCheckoutLink(deps),
  };
}

const input = (over: Partial<StartDraftCheckoutInput> = {}): StartDraftCheckoutInput => ({
  tenantId: T,
  draftOrderRef: DRAFT,
  draftNumber: "D3",
  currency: "EGP",
  items: [
    {
      productId: "11111111-1111-7111-8111-111111111111",
      variantId: "v-1",
      sku: "TEE",
      title: "Tee",
      variantTitle: null,
      quantity: 2,
      unitPriceAmountMinor: 25000,
      currency: "EGP",
    },
  ],
  contactEmail: "sara@example.com",
  shippingAddress: ADDRESS,
  billingAddress: ADDRESS,
  discount: { title: "Loyal customer", amountMinor: 5000 },
  shipping: { title: "Courier", amountMinor: 4000 },
  ...over,
});

describe("StartDraftCheckout (spec §4.5 step 2)", () => {
  it("builds an open session with the draft's lines, contact, addresses, terms, tax and totals", async () => {
    const w = world();
    const { checkoutSessionId } = value(await w.start.execute(input()));
    const session = await w.sessions.findById(checkoutSessionId, T);
    expect(session?.state.value).toBe("started");
    expect(session?.cartRef).toBe(`draft:${DRAFT}`);
    expect(session?.draftTerms?.draftNumber).toBe("D3");
    expect(session?.contactEmail?.value).toBe("sara@example.com");
    expect(session?.taxMinor).toBe(700);
    expect(session?.totals?.totalMinor).toBe(50000 - 5000 + 4000 + 700);
  });

  it("mints a 43-character server sessionRef that is never the same twice", async () => {
    const w = world();
    const a = await w.sessions.findById(value(await w.start.execute(input())).checkoutSessionId, T);
    const b = await w.sessions.findById(value(await w.start.execute(input())).checkoutSessionId, T);
    expect(a?.sessionRef).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a?.sessionRef).not.toBe(b?.sessionRef);
  });

  it("expires the session it replaces — only when it is this draft's and still open", async () => {
    const w = world();
    const first = value(await w.start.execute(input())).checkoutSessionId;
    const foreign = value(
      await w.start.execute(input({ draftOrderRef: "other-draft" })),
    ).checkoutSessionId;
    value(await w.start.execute(input({ replaces: first })));
    value(await w.start.execute(input({ replaces: foreign })));
    expect((await w.sessions.findById(first, T))?.state.value).toBe("expired");
    expect((await w.sessions.findById(foreign, T))?.state.value).toBe("started");
  });

  it("refuses with DRAFT_COMPLETED when the session it replaces became this draft's order, writing nothing", async () => {
    // Final review I-1: the caller read the session open; the shopper's order landed before this tx.
    const w = world();
    const first = value(await w.start.execute(input())).checkoutSessionId;
    const paid = await w.sessions.findById(first, T);
    paid?.complete("order-a", "evt-complete", NOW);
    if (paid !== null) await w.sessions.save(paid, T);
    const save = vi.spyOn(w.sessions, "save");

    const refused = failure(await w.start.execute(input({ replaces: first })));

    expect(refused.message).toMatch(/^DRAFT_COMPLETED:/);
    expect(save).not.toHaveBeenCalled();
    const kept = await w.sessions.findById(first, T);
    expect(kept?.state.value).toBe("completed");
    expect(kept?.orderRef).toBe("order-a");
  });

  it("still builds past a completed session that is NOT this draft's (a foreign ref is ignored)", async () => {
    const w = world();
    const foreign = value(
      await w.start.execute(input({ draftOrderRef: "other-draft" })),
    ).checkoutSessionId;
    const placed = await w.sessions.findById(foreign, T);
    placed?.complete("order-b", "evt-complete", NOW);
    if (placed !== null) await w.sessions.save(placed, T);
    value(await w.start.execute(input({ replaces: foreign })));
  });

  it("refuses a province that is not the country's (422 with the field)", async () => {
    const w = world();
    const refused = failure(
      await w.start.execute(input({ shippingAddress: { ...ADDRESS, province: "SA-01" } })),
    );
    expect(refused.code).toBe("VALIDATION");
  });

  it("answers a total past the 32-bit columns with its DRAFT_TOTAL_TOO_LARGE prefix and saves nothing", async () => {
    const w = world();
    const huge = new StartDraftCheckout({
      sessions: w.sessions,
      links: w.links,
      unitOfWork: new InMemoryUnitOfWork(),
      idGenerator: { generate: () => "01920000-0000-7000-8000-0000000000ff" },
      clock: { now: () => NOW },
      taxCalculation: { calculate: async () => ({ taxMinor: 2_147_483_647, included: false }) },
    });
    const refused = failure(await huge.execute(input()));
    expect(refused.message).toMatch(/^DRAFT_TOTAL_TOO_LARGE:/);
    expect(await w.sessions.findById("01920000-0000-7000-8000-0000000000ff", T)).toBeNull();
  });

  it("a refused start leaves the session it would replace open (nothing is written before the refusal)", async () => {
    const w = world();
    const first = value(await w.start.execute(input())).checkoutSessionId;
    const huge = new StartDraftCheckout({
      sessions: w.sessions,
      links: w.links,
      unitOfWork: new InMemoryUnitOfWork(),
      idGenerator: { generate: () => "01920000-0000-7000-8000-0000000000ff" },
      clock: { now: () => NOW },
      taxCalculation: { calculate: async () => ({ taxMinor: 2_147_483_647, included: false }) },
    });
    const refused = failure(await huge.execute(input({ replaces: first })));
    expect(refused.message).toMatch(/^DRAFT_TOTAL_TOO_LARGE:/);
    expect((await w.sessions.findById(first, T))?.state.value).toBe("started");
    expect(await w.sessions.findById("01920000-0000-7000-8000-0000000000ff", T)).toBeNull();
  });
});

describe("validCheckoutAddress / checkoutAddressProblem (the one address rule)", () => {
  it("answers the field problem first, then the province, else none", () => {
    expect(checkoutAddressProblem(ADDRESS)).toBeNull();
    expect(checkoutAddressProblem({ ...ADDRESS, city: " " })?.fields).toEqual([
      { field: "city", message: "required" },
    ]);
    expect(checkoutAddressProblem({ ...ADDRESS, province: "SA-01" })?.fields[0]?.field).toBe(
      "province",
    );
    const address = validCheckoutAddress(ADDRESS);
    expect(address.ok && address.value.province).toBe("EG-C");
  });
});

describe("SelectDraftPayment (Ruling 8)", () => {
  it("records cod or manual on a draft session only", async () => {
    const w = world();
    const { checkoutSessionId } = value(await w.start.execute(input()));
    value(await w.pay.execute({ tenantId: T, checkoutSessionId, provider: "manual" }));
    expect((await w.sessions.findById(checkoutSessionId, T))?.paymentSelection?.provider).toBe(
      "manual",
    );
  });

  it("refuses a shopper's own (non-draft) checkout", async () => {
    const w = world();
    const id = "01920000-0000-7000-8000-0000000000aa";
    await w.sessions.save(
      CheckoutSession.start(UniqueEntityId.from(id), "cart-1", undefined, "guest-1", "EGP"),
      T,
    );
    const refused = failure(
      await w.pay.execute({ tenantId: T, checkoutSessionId: id, provider: "manual" }),
    );
    expect(refused.message).toMatch(/Only a draft order's checkout/);
    expect((await w.sessions.findById(id, T))?.paymentSelection).toBeUndefined();
  });
});

describe("invoice links (spec §4.7)", () => {
  it("issues a 30-day link that resolves to the draft, and the claim hands the session to the opener", async () => {
    const w = world();
    const { checkoutSessionId } = value(await w.start.execute(input()));
    const issued = value(
      await w.issue.execute({ tenantId: T, draftOrderRef: DRAFT, createdBy: "staff-op" }),
    );
    expect(new Date(issued.expiresAt).getTime() - NOW.getTime()).toBe(30 * 24 * 3_600_000);
    const resolved = value(await w.resolve.execute({ tenantId: T, token: issued.token }));
    expect(resolved.purpose).toBe("invoice");
    if (resolved.purpose !== "invoice") throw new Error("unreachable");
    expect(resolved.draftOrderRef).toBe(DRAFT);
    const claimed = value(
      await w.claim.execute({
        tenantId: T,
        linkId: resolved.link.id,
        checkoutSessionId,
        sessionRef: "guest-1",
      }),
    );
    expect(claimed).toEqual({ checkoutSessionId, claimCount: 1 });
    expect((await w.sessions.findById(checkoutSessionId, T))?.sessionRef).toBe("guest-1");
    // The last opener owns it (spec §4.7 decision).
    const again = value(
      await w.claim.execute({
        tenantId: T,
        linkId: resolved.link.id,
        checkoutSessionId,
        sessionRef: "guest-2",
      }),
    );
    expect(again.claimCount).toBe(2);
    expect((await w.sessions.findById(checkoutSessionId, T))?.sessionRef).toBe("guest-2");
  });

  it("a revoked or expired link, or another shop, answers LINK_INVALID; a foreign session answers DRAFT_BUSY", async () => {
    const w = world();
    const { checkoutSessionId } = value(await w.start.execute(input()));
    const foreign = value(
      await w.start.execute(input({ draftOrderRef: "other-draft" })),
    ).checkoutSessionId;
    const issued = value(
      await w.issue.execute({ tenantId: T, draftOrderRef: DRAFT, createdBy: "staff-op" }),
    );
    const busy = failure(
      await w.claim.execute({
        tenantId: T,
        linkId: issued.linkId,
        checkoutSessionId: foreign,
        sessionRef: "g",
      }),
    );
    expect(busy.message).toMatch(/^DRAFT_BUSY:/);
    // A refused claim never counts.
    expect((await w.links.findById(issued.linkId, T))?.claimCount).toBe(0);
    expect(
      failure(await w.resolve.execute({ tenantId: "tenant-b", token: issued.token })).message,
    ).toMatch(/^LINK_INVALID:/);
    expect(value(await w.revoke.execute({ tenantId: T, draftOrderRef: DRAFT }))).toEqual({
      revoked: 1,
    });
    expect(failure(await w.resolve.execute({ tenantId: T, token: issued.token })).message).toMatch(
      /^LINK_INVALID:/,
    );
    expect(
      failure(
        await w.claim.execute({
          tenantId: T,
          linkId: issued.linkId,
          checkoutSessionId,
          sessionRef: "g",
        }),
      ).message,
    ).toMatch(/^LINK_INVALID:/);
    const later = value(
      await w.issue.execute({ tenantId: T, draftOrderRef: DRAFT, createdBy: "staff-op" }),
    );
    w.advance(30 * 24 * 3_600_000);
    expect(failure(await w.resolve.execute({ tenantId: T, token: later.token })).message).toMatch(
      /^LINK_INVALID:/,
    );
  });

  it("a recovery link's id never claims an invoice checkout (LINK_INVALID, nothing counted)", async () => {
    const w = world();
    const { checkoutSessionId } = value(await w.start.execute(input()));
    const recovery = CheckoutLink.issue({
      id: "01920000-0000-7000-8000-0000000000ee",
      purpose: "recovery",
      target: { checkoutSessionId },
      createdBy: "staff-op",
      now: NOW,
      ttlMs: RECOVERY_LINK_TTL_MS,
    }).link;
    await w.links.save(recovery, T);
    const before = (await w.sessions.findById(checkoutSessionId, T))?.sessionRef;
    const refused = failure(
      await w.claim.execute({
        tenantId: T,
        linkId: recovery.id,
        checkoutSessionId,
        sessionRef: "g",
      }),
    );
    expect(refused.message).toMatch(/^LINK_INVALID:/);
    expect((await w.links.findById(recovery.id, T))?.claimCount).toBe(0);
    expect((await w.sessions.findById(checkoutSessionId, T))?.sessionRef).toBe(before);
  });

  it("an empty opener is refused before the claim is counted", async () => {
    const w = world();
    const { checkoutSessionId } = value(await w.start.execute(input()));
    const issued = value(
      await w.issue.execute({ tenantId: T, draftOrderRef: DRAFT, createdBy: "staff-op" }),
    );
    const refused = failure(
      await w.claim.execute({
        tenantId: T,
        linkId: issued.linkId,
        checkoutSessionId,
        sessionRef: " ",
      }),
    );
    expect(refused.code).toBe("VALIDATION");
    expect((await w.links.findById(issued.linkId, T))?.claimCount).toBe(0);
  });

  it("revoking writes only the revocation: the claim count and result stay", async () => {
    const w = world();
    const { checkoutSessionId } = value(await w.start.execute(input()));
    const issued = value(
      await w.issue.execute({ tenantId: T, draftOrderRef: DRAFT, createdBy: "staff-op" }),
    );
    value(
      await w.claim.execute({
        tenantId: T,
        linkId: issued.linkId,
        checkoutSessionId,
        sessionRef: "g",
      }),
    );
    value(await w.revoke.execute({ tenantId: T, draftOrderRef: DRAFT }));
    const [link] = await w.links.listForDraft(DRAFT, T);
    expect(link?.revokedAt).toEqual(NOW);
    expect(link?.claimCount).toBe(1);
    expect(link?.resultCheckoutRef).toBe(checkoutSessionId);
  });
});
