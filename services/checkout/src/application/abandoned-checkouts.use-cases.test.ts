import { describe, expect, it, vi } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import type { Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { createFakePrisma } from "@platform/db/testing";
import { CheckoutLink, hashLinkToken, RECOVERY_LINK_TTL_MS } from "../domain/checkout-link";
import { CheckoutSession } from "../domain/checkout-session";
import { CheckoutAddress } from "../domain/value-objects/checkout-address";
import { CheckoutItem } from "../domain/value-objects/checkout-item";
import { ContactEmail } from "../domain/value-objects/contact-email";
import { CheckoutEventTranslator } from "../infrastructure/checkout-event-translator";
import { InMemoryCheckoutLinkRepository } from "../infrastructure/in-memory-checkout-link-repository";
import { InMemoryCheckoutSessionRepository } from "../infrastructure/in-memory-checkout-session-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { PrismaCheckoutLinkRepository } from "../infrastructure/prisma-checkout-link-repository";
import {
  GetAbandonedCheckout,
  IssueRecoveryLink,
  LINK_INVALID,
  ListAbandonedCheckouts,
  ResolveCheckoutLink,
  StartRecoveredCheckout,
} from "./abandoned-checkouts.use-cases";

const T0 = new Date("2026-10-18T09:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TENANT = "tenant-a";
const SESSION_ID = "01920000-0000-7000-8000-000000000001";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function value<T>(result: Result<T, DomainError>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

function error<T>(result: Result<T, DomainError>): DomainError {
  if (result.ok) throw new Error("expected an error");
  return result.error;
}

function world() {
  let now = T0;
  const clock = { now: () => now };
  const sessions = new InMemoryCheckoutSessionRepository({
    outbox: new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new CheckoutEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "checkout",
    }),
    context: rootEventContext({ generate: () => "evt-x" }),
    clock,
  });
  const links = new InMemoryCheckoutLinkRepository();
  let n = 0;
  const generated: string[] = [];
  const deps = {
    abandoned: sessions,
    sessions,
    links,
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator: {
      generate: () => {
        const id = `01920000-0000-7000-8000-0000000a${(n += 1).toString(16).padStart(4, "0")}`;
        generated.push(id);
        return id;
      },
    },
    clock,
  };
  return {
    deps,
    generated,
    sessions,
    links,
    now: () => now,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    list: new ListAbandonedCheckouts(deps),
    get: new GetAbandonedCheckout(deps),
    issue: new IssueRecoveryLink(deps),
    resolve: new ResolveCheckoutLink(deps),
    startRecovered: new StartRecoveredCheckout(deps),
  };
}

type World = ReturnType<typeof world>;

async function abandon(w: World, id = SESSION_ID): Promise<CheckoutSession> {
  const s = CheckoutSession.start(
    UniqueEntityId.from(id),
    "cart-1",
    undefined,
    "ref-original",
    "EGP",
  );
  s.loadItems([must(CheckoutItem.create("p-1", 1, 1000, "EGP"))]);
  s.setContactEmail(must(ContactEmail.create("sara@example.com")));
  s.setShippingAddress(
    must(
      CheckoutAddress.create({
        name: "Mona Ali",
        line1: "5 Nile St",
        city: "Cairo",
        postalCode: "11511",
        country: "EG",
      }),
    ),
  );
  await w.sessions.save(s, TENANT);
  return s;
}

/** An abandoned checkout (idle 2 hours) with one recovery link; answers the token. */
async function withLink(w: World): Promise<string> {
  await abandon(w);
  w.advance(2 * HOUR);
  return value(
    await w.issue.execute({
      tenantId: TENANT,
      checkoutSessionId: SESSION_ID,
      createdBy: "staff-op",
    }),
  ).token;
}

describe("ListAbandonedCheckouts", () => {
  it("lists a checkout only once it has been idle for an hour", async () => {
    const w = world();
    await abandon(w);
    w.advance(59 * 60_000);
    expect(value(await w.list.execute({ tenantId: TENANT })).items).toEqual([]);
    w.advance(2 * 60_000);
    const page = value(await w.list.execute({ tenantId: TENANT }));
    expect(page.items.map((entry) => entry.record.session.id.toString())).toEqual([SESSION_ID]);
    expect(page.items[0]?.lastLinkIssuedAt).toBeNull();
  });

  it("shows when the newest recovery link was issued", async () => {
    const w = world();
    await withLink(w);
    w.advance(HOUR);
    value(
      await w.issue.execute({
        tenantId: TENANT,
        checkoutSessionId: SESSION_ID,
        createdBy: "staff-op",
      }),
    );
    const page = value(await w.list.execute({ tenantId: TENANT }));
    expect(page.items[0]?.lastLinkIssuedAt).toEqual(w.now());
  });
});

describe("GetAbandonedCheckout", () => {
  it("answers the checkout with its links, newest first", async () => {
    const w = world();
    await withLink(w);
    w.advance(HOUR);
    value(
      await w.issue.execute({
        tenantId: TENANT,
        checkoutSessionId: SESSION_ID,
        createdBy: "staff-op",
      }),
    );
    const found = value(await w.get.execute({ tenantId: TENANT, checkoutSessionId: SESSION_ID }));
    expect(found.record.session.id.toString()).toBe(SESSION_ID);
    expect(found.links.map((link) => link.createdAt)).toEqual([
      w.now(),
      new Date(T0.getTime() + 2 * HOUR),
    ]);
  });

  it("is 404 for a checkout that is not abandoned (fresh, completed) and for an unknown id", async () => {
    const w = world();
    const s = await abandon(w);
    expect(
      error(await w.get.execute({ tenantId: TENANT, checkoutSessionId: SESSION_ID })).code,
    ).toBe("NOT_FOUND");
    w.advance(2 * HOUR);
    s.complete("order-1", "evt", w.now());
    await w.sessions.save(s, TENANT);
    expect(
      error(await w.get.execute({ tenantId: TENANT, checkoutSessionId: SESSION_ID })).code,
    ).toBe("NOT_FOUND");
    expect(error(await w.get.execute({ tenantId: TENANT, checkoutSessionId: "nope" })).code).toBe(
      "NOT_FOUND",
    );
  });
});

describe("IssueRecoveryLink", () => {
  it("hands out a 43-character token once and stores only its hash, valid for 7 days", async () => {
    const w = world();
    await abandon(w);
    w.advance(2 * HOUR);
    const issued = value(
      await w.issue.execute({
        tenantId: TENANT,
        checkoutSessionId: SESSION_ID,
        createdBy: "staff-op",
      }),
    );
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.expiresAt).toBe(new Date(w.now().getTime() + 7 * DAY).toISOString());
    const stored = await w.links.findByTokenHash(hashLinkToken(issued.token), TENANT);
    expect(stored?.id).toBe(issued.linkId);
    expect(stored?.createdBy).toBe("staff-op");
    expect(await w.links.findByTokenHash(issued.token, TENANT)).toBeNull();
  });

  it("every copy mints a new token; the older one keeps working", async () => {
    const w = world();
    const first = await withLink(w);
    const second = value(
      await w.issue.execute({
        tenantId: TENANT,
        checkoutSessionId: SESSION_ID,
        createdBy: "staff-op",
      }),
    ).token;
    expect(second).not.toBe(first);
    expect((await w.resolve.execute({ tenantId: TENANT, token: first })).ok).toBe(true);
    expect((await w.resolve.execute({ tenantId: TENANT, token: second })).ok).toBe(true);
  });

  it("is 404 for a checkout that is not abandoned yet and 409 for one already recovered", async () => {
    const w = world();
    const s = await abandon(w);
    expect(
      error(
        await w.issue.execute({
          tenantId: TENANT,
          checkoutSessionId: SESSION_ID,
          createdBy: "staff-op",
        }),
      ).code,
    ).toBe("NOT_FOUND");
    w.advance(2 * HOUR);
    s.markRecovered("order-9", "evt", w.now());
    await w.sessions.save(s, TENANT);
    const refused = error(
      await w.issue.execute({
        tenantId: TENANT,
        checkoutSessionId: SESSION_ID,
        createdBy: "staff-op",
      }),
    );
    expect(refused.code).toBe("BUSINESS_RULE");
    expect(refused.message).toMatch(/^ALREADY_RECOVERED:/);
  });
});

describe("ResolveCheckoutLink", () => {
  it("answers the link and the abandoned checkout for a usable token", async () => {
    const w = world();
    const token = await withLink(w);
    const resolved = value(await w.resolve.execute({ tenantId: TENANT, token }));
    expect(resolved.purpose).toBe("recovery");
    if (resolved.purpose !== "recovery") throw new Error("unreachable");
    expect(resolved.session.id.toString()).toBe(SESSION_ID);
    expect(resolved.link.checkoutSessionId).toBe(SESSION_ID);
  });

  it("answers the SAME not-found for unknown, expired, revoked and other-shop tokens", async () => {
    const answers: DomainError[] = [];
    {
      const w = world();
      await withLink(w);
      answers.push(error(await w.resolve.execute({ tenantId: TENANT, token: "x".repeat(43) })));
    }
    {
      const w = world();
      const token = await withLink(w);
      w.advance(7 * 24 * HOUR);
      answers.push(error(await w.resolve.execute({ tenantId: TENANT, token })));
    }
    {
      const w = world();
      const token = await withLink(w);
      const link = await w.links.findByTokenHash(hashLinkToken(token), TENANT);
      link?.revoke(w.now());
      if (link) await w.links.save(link, TENANT);
      answers.push(error(await w.resolve.execute({ tenantId: TENANT, token })));
    }
    {
      const w = world();
      const token = await withLink(w);
      answers.push(error(await w.resolve.execute({ tenantId: "tenant-b", token })));
    }
    for (const answer of answers) {
      expect(answer.code).toBe("NOT_FOUND");
      expect(answer.message).toBe(answers[0]?.message);
      expect(answer.message.startsWith(LINK_INVALID)).toBe(true);
    }
  });

  it("a malformed token gets the same not-found without any link read", async () => {
    const w = world();
    const token = await withLink(w);
    const reads = vi.spyOn(w.links, "findByTokenHash");
    const wellFormedUnknown = error(
      await w.resolve.execute({ tenantId: TENANT, token: "x".repeat(43) }),
    );
    reads.mockClear();
    for (const malformed of ["", "short", `${token}A`, `${token.slice(1)}/`, "x".repeat(128)]) {
      const answer = error(await w.resolve.execute({ tenantId: TENANT, token: malformed }));
      expect(answer.code, malformed).toBe("NOT_FOUND");
      expect(answer.message, malformed).toBe(wellFormedUnknown.message);
    }
    expect(reads).not.toHaveBeenCalled();
  });

  it("a link whose checkout was since completed or recovered is spent (Review Focus 4)", async () => {
    for (const end of ["completed", "recovered"] as const) {
      const w = world();
      const token = await withLink(w);
      const s = await w.sessions.findById(SESSION_ID, TENANT);
      if (s === null) throw new Error("setup failed");
      if (end === "completed") s.complete("order-own", "evt", w.now());
      else s.markRecovered("order-9", "evt", w.now());
      await w.sessions.save(s, TENANT);
      const answer = error(await w.resolve.execute({ tenantId: TENANT, token }));
      expect(answer.code, end).toBe("NOT_FOUND");
      expect(answer.message.startsWith(LINK_INVALID), end).toBe(true);
    }
  });
});

describe("a recovery link never resumes a draft order's checkout (defence in depth)", () => {
  it("resolves to the same not-found as a spent link", async () => {
    const w = world();
    const token = await withLink(w);
    const s = await w.sessions.findById(SESSION_ID, TENANT);
    if (s === null) throw new Error("setup failed");
    s.applyDraftTerms({
      draftOrderRef: "d-1",
      draftNumber: "D1",
      shipping: { title: "Courier", amountMinor: 0 },
    });
    await w.sessions.save(s, TENANT);
    const answer = error(await w.resolve.execute({ tenantId: TENANT, token }));
    expect(answer.code).toBe("NOT_FOUND");
    expect(answer.message.startsWith(LINK_INVALID)).toBe(true);
  });
});

describe("StartRecoveredCheckout (spec §3.5 steps 3-5 in one unit of work)", () => {
  const CLONE_LINES = [
    { productId: "p-1", quantity: 2, unitPriceAmountMinor: 1200, currency: "EGP" },
  ];

  async function claimable(w: World): Promise<CheckoutLink> {
    const token = await withLink(w);
    return value(await w.resolve.execute({ tenantId: TENANT, token })).link;
  }

  const start = (w: World, linkId: string, tenantId = TENANT) =>
    w.startRecovered.execute({
      tenantId,
      linkId,
      cartRef: "cart-opener",
      sessionRef: "ref-opener",
      currency: "EGP",
      items: CLONE_LINES,
    });

  /** No session was saved under any id minted since `before`. */
  async function noCloneSince(w: World, before: number, label: string): Promise<void> {
    for (const id of w.generated.slice(before)) {
      expect(await w.sessions.findById(id, TENANT), label).toBeNull();
    }
  }

  it("opens the caller's own session with the given lines, contact and address, and counts the claim", async () => {
    const w = world();
    const link = await claimable(w);
    const started = value(await start(w, link.id));
    expect(started.claimCount).toBe(1);
    expect(started.checkoutSessionId).not.toBe(SESSION_ID);

    const clone = await w.sessions.findById(started.checkoutSessionId, TENANT);
    expect(clone?.sessionRef).toBe("ref-opener");
    expect(clone?.cartRef).toBe("cart-opener");
    expect(clone?.recoveredFromRef).toBe(SESSION_ID);
    expect(
      clone?.items.map((item) => [item.productRef, item.quantity, item.unitPriceAmountMinor]),
    ).toEqual([["p-1", 2, 1200]]);
    expect(clone?.contactEmail?.value).toBe("sara@example.com");
    expect(clone?.shippingAddress?.city).toBe("Cairo");

    const stored = await w.links.findById(link.id, TENANT);
    expect(stored?.claimCount).toBe(1);
    expect(stored?.resultCheckoutRef).toBe(started.checkoutSessionId);
    expect(stored?.lastClaimedAt).toEqual(w.now());
  });

  it("a link that expired or was revoked meanwhile is LINK_INVALID and leaves NO orphan clone", async () => {
    for (const end of ["expired", "revoked"] as const) {
      const w = world();
      const link = await claimable(w);
      if (end === "expired") w.advance(8 * DAY);
      else {
        const loaded = await w.links.findById(link.id, TENANT);
        if (loaded === null) throw new Error("setup failed");
        loaded.revoke(w.now());
        await w.links.save(loaded, TENANT);
      }
      const before = w.generated.length;
      const answer = error(await start(w, link.id));
      expect(answer.code, end).toBe("NOT_FOUND");
      expect(answer.message.startsWith(LINK_INVALID), end).toBe(true);
      await noCloneSince(w, before, end);
      expect((await w.links.findById(link.id, TENANT))?.claimCount, end).toBe(0);
    }
  });

  it("a claim may still resume an original that expired or failed after the link was issued (deliberate)", async () => {
    for (const end of ["expired", "failed"] as const) {
      const w = world();
      const link = await claimable(w);
      const original = await w.sessions.findById(SESSION_ID, TENANT);
      if (original === null) throw new Error("setup failed");
      if (end === "expired") original.expire("evt", w.now());
      else original.fail("payment declined", "evt", w.now());
      await w.sessions.save(original, TENANT);
      const started = value(await start(w, link.id));
      expect(started.claimCount, end).toBe(1);
      const clone = await w.sessions.findById(started.checkoutSessionId, TENANT);
      expect(clone?.recoveredFromRef, end).toBe(SESSION_ID);
    }
  });

  it("when the guarded claim itself refuses (revoked by a concurrent request), no clone is saved", async () => {
    const w = world();
    const link = await claimable(w);
    // The link still reads as usable, but the atomic, guarded increment no longer applies.
    const racing = new StartRecoveredCheckout({
      ...w.deps,
      links: {
        save: (l, tenantId) => w.links.save(l, tenantId),
        findById: (id, tenantId) => w.links.findById(id, tenantId),
        findByTokenHash: (hash, tenantId) => w.links.findByTokenHash(hash, tenantId),
        listForSessions: (ids, tenantId) => w.links.listForSessions(ids, tenantId),
        recordClaim: async () => null,
        revokeForDraft: async () => 0,
        listForDraft: async () => [],
      },
    });
    const before = w.generated.length;
    const answer = error(
      await racing.execute({
        tenantId: TENANT,
        linkId: link.id,
        cartRef: "cart-opener",
        sessionRef: "ref-opener",
        currency: "EGP",
        items: CLONE_LINES,
      }),
    );
    expect(answer.message.startsWith(LINK_INVALID)).toBe(true);
    expect(w.generated.length).toBeGreaterThan(before);
    await noCloneSince(w, before, "raced");
  });

  it("an original completed or recovered meanwhile is LINK_INVALID; nothing is written", async () => {
    for (const end of ["completed", "recovered"] as const) {
      const w = world();
      const link = await claimable(w);
      const s = await w.sessions.findById(SESSION_ID, TENANT);
      if (s === null) throw new Error("setup failed");
      if (end === "completed") s.complete("order-own", "evt", w.now());
      else s.markRecovered("order-9", "evt", w.now());
      await w.sessions.save(s, TENANT);
      const before = w.generated.length;
      expect(error(await start(w, link.id)).message.startsWith(LINK_INVALID), end).toBe(true);
      await noCloneSince(w, before, end);
      expect((await w.links.findById(link.id, TENANT))?.claimCount, end).toBe(0);
    }
  });

  it("is LINK_INVALID for an unknown link and for another shop's", async () => {
    const w = world();
    const link = await claimable(w);
    expect(error(await start(w, "nope")).message.startsWith(LINK_INVALID)).toBe(true);
    expect(error(await start(w, link.id, "tenant-b")).message.startsWith(LINK_INVALID)).toBe(true);
    expect((await w.links.findById(link.id, TENANT))?.claimCount).toBe(0);
  });

  it("refuses lines a checkout cannot hold (validated like LoadItems) without counting a claim", async () => {
    const w = world();
    const link = await claimable(w);
    const answer = await w.startRecovered.execute({
      tenantId: TENANT,
      linkId: link.id,
      cartRef: "cart-opener",
      sessionRef: "ref-opener",
      currency: "EGP",
      items: [{ productId: "p-1", quantity: 0, unitPriceAmountMinor: 1200, currency: "EGP" }],
    });
    expect(answer.ok).toBe(false);
    expect((await w.links.findById(link.id, TENANT))?.claimCount).toBe(0);
  });

  it("counts the claim in the SAME transaction the clone is saved in (Prisma links need the tx)", async () => {
    const fake = createFakePrisma();
    const links = new PrismaCheckoutLinkRepository({ prisma: fake.database });
    const w = world();
    await abandon(w);
    w.advance(2 * HOUR);
    const { link } = CheckoutLink.issue({
      id: "01920000-0000-7000-8000-0000000000c1",
      purpose: "recovery",
      target: { checkoutSessionId: SESSION_ID },
      createdBy: "staff-op",
      now: w.now(),
      ttlMs: RECOVERY_LINK_TTL_MS,
    });
    await links.save(link, TENANT, fake.database);
    const savedWith: unknown[] = [];
    const startRecovered = new StartRecoveredCheckout({
      ...w.deps,
      sessions: {
        findById: (id, tenantId) => w.sessions.findById(id, tenantId),
        save: async (session, tenantId, tx) => {
          savedWith.push(tx);
          await w.sessions.save(session, tenantId, tx);
        },
      },
      links,
      unitOfWork: { run: (work) => work(fake.database) },
    });
    const started = value(
      await startRecovered.execute({
        tenantId: TENANT,
        linkId: link.id,
        cartRef: "cart-opener",
        sessionRef: "ref-opener",
        currency: "EGP",
        items: CLONE_LINES,
      }),
    );
    expect(savedWith).toEqual([fake.database]);
    const stored = await links.findById(link.id, TENANT, fake.database);
    expect(stored?.claimCount).toBe(1);
    expect(stored?.resultCheckoutRef).toBe(started.checkoutSessionId);
  });
});
