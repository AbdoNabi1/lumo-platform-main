import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { createFakePrisma } from "@platform/db/testing";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { CheckoutLink, hashLinkToken, RECOVERY_LINK_TTL_MS } from "../domain/checkout-link";
import type { CheckoutLinkRepository } from "../domain/checkout-link-repository";
import { CheckoutSession } from "../domain/checkout-session";
import { FIXTURE_OLDER_THAN, seedAbandonedFixture } from "./abandoned-checkout-fixture";
import { CheckoutEventTranslator } from "./checkout-event-translator";
import { CheckoutSessionMapper } from "./checkout-session.mapper";
import { InMemoryCheckoutLinkRepository } from "./in-memory-checkout-link-repository";
import { InMemoryCheckoutSessionRepository } from "./in-memory-checkout-session-repository";
import { PrismaCheckoutLinkRepository } from "./prisma-checkout-link-repository";
import { PrismaCheckoutSessionRepository } from "./prisma-checkout-session-repository";

/** ADR-0014 (WP-10, T10.3): one Checkout repository serves every tenant. */
function newSession(id: string): CheckoutSession {
  return CheckoutSession.start(UniqueEntityId.from(id), "cart-1", "customer-1", "session-1", "USD");
}

function repository(outbox?: OutboxWriter) {
  const writer =
    outbox ??
    new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new CheckoutEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "checkout",
    });
  return new InMemoryCheckoutSessionRepository({
    outbox: writer,
    context: rootEventContext({ generate: () => "evt-x" }),
  });
}

describe("checkout tenant isolation (ADR-0014)", () => {
  it("two tenants sharing one repository and an identical session id never see each other's sessions", async () => {
    const repo = repository();
    await repo.save(newSession("cs-1"), "tenant-a");

    expect(await repo.findById("cs-1", "tenant-b")).toBeNull();
    expect(await repo.findById("cs-1", "tenant-a")).not.toBeNull();
  });

  it("merges the per-call tenantId into the outbox event context at write time", async () => {
    await assertWriteTimeTenant("checkout", async (outbox, tenantId) => {
      const session = newSession("cs-1");
      session.fail("payment declined", "evt-1", new Date(0));
      await repository(outbox).save(session, tenantId);
    });
  });
});

// ── order operations Part 3: recovery links ────────────────────────────────────────────────────
// The Prisma adapter runs over the fake that applies `where` literally: it cannot pass because of RLS.
describe("checkout links tenant isolation (order operations Part 3)", () => {
  const VICTIM_SESSION = "01920000-0000-7000-8000-00000000000b";

  function layers(): readonly [string, CheckoutLinkRepository, unknown][] {
    const fake = createFakePrisma();
    return [
      [
        "prisma over fake-prisma",
        new PrismaCheckoutLinkRepository({ prisma: fake.database }),
        fake.database,
      ],
      ["in-memory", new InMemoryCheckoutLinkRepository(), undefined],
    ];
  }

  it("a token issued in shop B is unknown in shop A, by hash, id or checkout", async () => {
    for (const [layer, links, tx] of layers()) {
      const { link, token } = CheckoutLink.issue({
        id: "01920000-0000-7000-8000-0000000000b1",
        purpose: "recovery",
        target: { checkoutSessionId: VICTIM_SESSION },
        createdBy: "staff-b",
        now: new Date(0),
        ttlMs: RECOVERY_LINK_TTL_MS,
      });
      await links.save(link, "tenant-b", tx);

      expect(await links.findByTokenHash(hashLinkToken(token), "tenant-a", tx), layer).toBeNull();
      expect(await links.findById(link.id, "tenant-a", tx), layer).toBeNull();
      expect(await links.listForSessions([VICTIM_SESSION], "tenant-a", tx), layer).toEqual([]);
      expect(
        await links.findByTokenHash(hashLinkToken(token), "tenant-b", tx),
        layer,
      ).not.toBeNull();
    }
  });
});

describe("abandoned checkouts tenant isolation (order operations Part 3)", () => {
  it("shop A never lists or reads shop B's abandoned checkout (in-memory; Prisma: SQL filters tenant_id)", async () => {
    let now = new Date(0);
    const writer = new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new CheckoutEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "checkout",
    });
    const repo = new InMemoryCheckoutSessionRepository({
      outbox: writer,
      context: rootEventContext({ generate: () => "evt-x" }),
      clock: { now: () => now },
    });
    let n = 0;
    const ids = await seedAbandonedFixture(
      {
        save: async (s, t, at) => {
          now = at;
          await repo.save(s, t);
        },
      },
      { tenantId: "tenant-a", otherTenantId: "tenant-b" },
      () => `01920000-0000-7000-8000-${(n += 1).toString(16).padStart(12, "0")}`,
    );
    const listedForA = await repo.listAbandoned(
      { olderThan: FIXTURE_OLDER_THAN, search: "sara" },
      "tenant-a",
    );
    expect(listedForA.items.map((r) => r.session.id.toString())).toEqual([ids.emailOnly]);
    expect(await repo.findRecord(ids.otherTenant, "tenant-a")).toBeNull();
    expect(await repo.findRecord(ids.emailOnly, "tenant-b")).toBeNull();
  });

  it("PrismaCheckoutSessionRepository.findRecord filters by tenant (over fake-prisma)", async () => {
    const fake = createFakePrisma();
    const id = "01920000-0000-7000-8000-00000000000c";
    const session = CheckoutSession.start(
      UniqueEntityId.from(id),
      "cart-1",
      undefined,
      "ref",
      "EGP",
    );
    await fake.database.checkoutSession.create({
      data: {
        ...CheckoutSessionMapper.toRow(session, "tenant-b"),
        createdAt: new Date(0),
        updatedAt: new Date(0),
      } as never,
    });
    const prismaRepo = new PrismaCheckoutSessionRepository({
      prisma: fake.database,
      outbox: undefined as never,
      context: rootEventContext({ generate: () => "evt-x" }),
    });
    expect(await prismaRepo.findRecord(id, "tenant-a")).toBeNull();
    expect(await prismaRepo.findRecord(id, "tenant-b")).not.toBeNull();
  });
});
