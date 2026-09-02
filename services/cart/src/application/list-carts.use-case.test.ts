import { describe, expect, it } from "vitest";
import type { Clock } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Cart } from "../domain/cart";
import { CartEventTranslator } from "../infrastructure/cart-event-translator";
import { InMemoryCartRepository } from "../infrastructure/in-memory-cart-repository";
import { ListCarts } from "./list-carts.use-case";

const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };

function repo(): InMemoryCartRepository {
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new CartEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "cart",
  });
  const context = rootEventContext({ generate: () => "evt-1" });
  return new InMemoryCartRepository({ outbox, context });
}

function cart(id: string, status: Cart["status"] = "active"): Cart {
  const c = Cart.create(UniqueEntityId.from(id), "customer-1", `session-${id}`, "USD");
  if (status === "abandoned") c.abandon("evt-1", clock.now());
  return c;
}

describe("ListCarts (Phase 4 T4.13)", () => {
  it("paginates", async () => {
    const carts = repo();
    for (let i = 0; i < 3; i += 1) {
      await carts.save(cart(`cart-${i}`));
    }
    const useCase = new ListCarts({ carts });

    const page = await useCase.execute({ first: 2 });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items).toHaveLength(2);
    expect(page.value.pageInfo.hasNextPage).toBe(true);

    const rest = await useCase.execute({
      first: 10,
      after: page.value.pageInfo.endCursor ?? undefined,
    });
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.value.items).toHaveLength(1);
    expect(rest.value.pageInfo.hasNextPage).toBe(false);
  });

  it("an optional status filter narrows the list to abandoned-cart recovery", async () => {
    const carts = repo();
    await carts.save(cart("cart-active", "active"));
    await carts.save(cart("cart-abandoned", "abandoned"));
    const useCase = new ListCarts({ carts });

    const abandoned = await useCase.execute({ status: "abandoned" });
    expect(abandoned.ok).toBe(true);
    if (!abandoned.ok) return;
    expect(abandoned.value.items).toHaveLength(1);
    expect(abandoned.value.items[0]?.id.toString()).toBe("cart-abandoned");

    const active = await useCase.execute({ status: "active" });
    expect(active.ok).toBe(true);
    if (!active.ok) return;
    expect(active.value.items).toHaveLength(1);
    expect(active.value.items[0]?.id.toString()).toBe("cart-active");
  });
});
