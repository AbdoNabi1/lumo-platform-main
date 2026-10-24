import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { createFakePrisma } from "@platform/db/testing";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { CheckoutLink, hashLinkToken, RECOVERY_LINK_TTL_MS } from "../domain/checkout-link";
import type { CheckoutLinkRepository } from "../domain/checkout-link-repository";
import { CheckoutSession } from "../domain/checkout-session";
import { CheckoutEventTranslator } from "./checkout-event-translator";
import { InMemoryCheckoutLinkRepository } from "./in-memory-checkout-link-repository";
import { InMemoryCheckoutSessionRepository } from "./in-memory-checkout-session-repository";
import { PrismaCheckoutLinkRepository } from "./prisma-checkout-link-repository";

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
