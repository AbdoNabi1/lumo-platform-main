import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { ValidationError } from "@platform/utils";
import { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import {
  DEFAULT_CHECKOUT_SETTINGS,
  type CheckoutSettingsValues,
} from "../domain/checkout-settings";
import { CheckoutAddress } from "../domain/value-objects/checkout-address";
import { CheckoutItem } from "../domain/value-objects/checkout-item";
import { InMemoryCheckoutSettingsRepository } from "../infrastructure/in-memory-checkout-settings-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { LoadItems, SetShippingAddress } from "./checkout-details.use-cases";
import { CompleteCheckout } from "./complete-checkout.use-case";
import type { OrderCreationPort } from "./ports";

class FakeSessions implements CheckoutSessionRepository {
  private readonly store = new Map<string, CheckoutSession>();
  seed(session: CheckoutSession): void {
    this.store.set(session.id.toString(), session);
  }
  async save(session: CheckoutSession): Promise<void> {
    this.store.set(session.id.toString(), session);
  }
  async findById(id: string): Promise<CheckoutSession | null> {
    return this.store.get(id) ?? null;
  }
}

const base = { line1: "1 Main St", city: "Springfield", postalCode: "00000", country: "US" };
const settingsWith = (patch: Partial<CheckoutSettingsValues>): CheckoutSettingsValues => ({
  ...DEFAULT_CHECKOUT_SETTINGS,
  ...patch,
});

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function fieldsOf(result: { ok: boolean; error?: unknown }): string[] {
  if (result.ok) throw new Error("expected err");
  return ((result.error as ValidationError).fields ?? []).map((i) => i.field).sort();
}

function shippingSetup() {
  const sessions = new FakeSessions();
  const session = CheckoutSession.start(
    UniqueEntityId.from("cs-1"),
    "cart-1",
    undefined,
    "ref",
    "USD",
  );
  sessions.seed(session);
  const settings = new InMemoryCheckoutSettingsRepository();
  const useCase = new SetShippingAddress({
    sessions,
    unitOfWork: new InMemoryUnitOfWork(),
    settings,
  });
  const set = (extra: Record<string, string | undefined> = {}) =>
    useCase.execute({ tenantId: "t1", checkoutSessionId: "cs-1", ...base, ...extra });
  return { session, settings, set };
}

describe("shipping address vs checkout settings (server side, D34)", () => {
  it("default (no row): an address without name or phone is accepted, exactly as before", async () => {
    const { session, set } = shippingSetup();
    expect((await set()).ok).toBe(true);
    expect(session.shippingAddress?.name).toBeUndefined();
  });

  it("saved defaults: a missing name is 422 on `name`", async () => {
    const { settings, set } = shippingSetup();
    await settings.save("t1", DEFAULT_CHECKOUT_SETTINGS, null);
    expect(fieldsOf(await set({ phone: "01000000000" }))).toEqual(["name"]);
  });

  it("saved defaults: a missing phone is 422 on `phone`; both missing names both", async () => {
    const { settings, set } = shippingSetup();
    await settings.save("t1", DEFAULT_CHECKOUT_SETTINGS, null);
    expect(fieldsOf(await set({ name: "Mona" }))).toEqual(["phone"]);
    expect(fieldsOf(await set())).toEqual(["name", "phone"]);
    expect((await set({ name: "Mona", phone: "01000000000" })).ok).toBe(true);
  });

  it("name optional: accepted without a name, and a blank name is simply absent", async () => {
    const { session, settings, set } = shippingSetup();
    await settings.save("t1", settingsWith({ nameMode: "optional", phoneMode: "optional" }), null);
    expect((await set({ name: "   " })).ok).toBe(true);
    expect(session.shippingAddress?.name).toBeUndefined();
  });

  it("phone optional: accepted without a phone, but a phone that IS given is still validated", async () => {
    const { settings, set } = shippingSetup();
    await settings.save("t1", settingsWith({ nameMode: "optional", phoneMode: "optional" }), null);
    expect((await set()).ok).toBe(true);
    expect(fieldsOf(await set({ phone: "abc" }))).toEqual(["phone"]);
  });

  it("line2 required: empty is 422 on `line2`, filled is accepted", async () => {
    const { session, settings, set } = shippingSetup();
    await settings.save(
      "t1",
      settingsWith({ nameMode: "optional", phoneMode: "optional", line2Mode: "required" }),
      null,
    );
    expect(fieldsOf(await set())).toEqual(["line2"]);
    expect(fieldsOf(await set({ line2: "  " }))).toEqual(["line2"]);
    expect((await set({ line2: "Floor 3" })).ok).toBe(true);
    expect(session.shippingAddress?.line2).toBe("Floor 3");
  });

  it("line2 hidden: whatever is sent is dropped", async () => {
    const { session, settings, set } = shippingSetup();
    await settings.save(
      "t1",
      settingsWith({ nameMode: "optional", phoneMode: "optional", line2Mode: "hidden" }),
      null,
    );
    expect((await set({ line2: "Flat 9" })).ok).toBe(true);
    expect(session.shippingAddress?.line2).toBeUndefined();
  });

  it("line2 optional (default) keeps what is sent", async () => {
    const { session, set } = shippingSetup();
    expect((await set({ line2: "Flat 9" })).ok).toBe(true);
    expect(session.shippingAddress?.line2).toBe("Flat 9");
  });

  it("settings are per tenant: another shop's rules do not bind this one", async () => {
    const { settings, set } = shippingSetup();
    await settings.save("other-tenant", DEFAULT_CHECKOUT_SETTINGS, null);
    expect((await set()).ok).toBe(true);
  });
});

class FakeOrderCreation implements OrderCreationPort {
  calls = 0;
  async create(): Promise<{ readonly orderRef: string }> {
    this.calls += 1;
    return { orderRef: "order-1" };
  }
}
const ids: IdGenerator = (() => {
  let n = 0;
  return { generate: () => `evt-${(n += 1)}` };
})();
const clock: Clock = { now: () => new Date("2026-11-26T00:00:00.000Z") };

function completeSetup(shipping: { name?: string; phone?: string; line2?: string }) {
  const sessions = new FakeSessions();
  const session = CheckoutSession.start(
    UniqueEntityId.from("cs-1"),
    "cart-1",
    "customer-1",
    "ref",
    "USD",
  );
  session.loadItems([must(CheckoutItem.create("product-1", 1, 1000, "USD"))]);
  session.setBillingAddress(must(CheckoutAddress.create(base)));
  session.setShippingAddress(must(CheckoutAddress.create({ ...base, ...shipping })));
  session.recalculateTotals("evt-t", new Date(0));
  session.pullDomainEvents();
  sessions.seed(session);
  const settings = new InMemoryCheckoutSettingsRepository();
  const orderCreation = new FakeOrderCreation();
  const useCase = new CompleteCheckout({
    sessions,
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator: ids,
    clock,
    orderCreation,
    settings,
  });
  const complete = (extra: { actorRef?: string } = {}) =>
    useCase.execute({
      tenantId: "t1",
      checkoutSessionId: "cs-1",
      idempotencyKey: "idem-1",
      ...extra,
    });
  return { settings, orderCreation, complete };
}

describe("complete re-checks the stored address against the CURRENT settings", () => {
  it("default (no row): an address with no name or phone completes, as before", async () => {
    const { complete, orderCreation } = completeSetup({});
    expect((await complete()).ok).toBe(true);
    expect(orderCreation.calls).toBe(1);
  });

  it("stale settings mid-checkout: phone was optional when the address was typed, then the merchant made it required -> 422 phone, no order", async () => {
    const { settings, complete, orderCreation } = completeSetup({ name: "Mona" });
    await settings.save("t1", settingsWith({ phoneMode: "optional" }), null);
    await settings.save("t1", settingsWith({ phoneMode: "required" }), 1);
    expect(fieldsOf(await complete())).toEqual(["phone"]);
    expect(orderCreation.calls).toBe(0);
  });

  it("the same address completes while the merchant still has phone optional", async () => {
    const { settings, complete, orderCreation } = completeSetup({ name: "Mona" });
    await settings.save("t1", settingsWith({ phoneMode: "optional" }), null);
    expect((await complete()).ok).toBe(true);
    expect(orderCreation.calls).toBe(1);
  });

  it("line2 became required after the address was typed -> 422 line2", async () => {
    const { settings, complete, orderCreation } = completeSetup({
      name: "Mona",
      phone: "01000000000",
    });
    await settings.save("t1", settingsWith({ line2Mode: "required" }), null);
    expect(fieldsOf(await complete())).toEqual(["line2"]);
    expect(orderCreation.calls).toBe(0);
  });

  it("an address that satisfies the saved settings completes", async () => {
    const { settings, complete } = completeSetup({ name: "Mona", phone: "01000000000" });
    await settings.save("t1", DEFAULT_CHECKOUT_SETTINGS, null);
    expect((await complete()).ok).toBe(true);
  });

  it("a merchant completing on a shopper's behalf (actorRef) is not held to the shopper form", async () => {
    const { settings, complete } = completeSetup({});
    await settings.save("t1", DEFAULT_CHECKOUT_SETTINGS, null);
    expect((await complete({ actorRef: "staff-1" })).ok).toBe(true);
  });
});

describe("checkout item loading vs the add-to-cart limit", () => {
  function itemsSetup() {
    const sessions = new FakeSessions();
    sessions.seed(
      CheckoutSession.start(UniqueEntityId.from("cs-1"), "cart-1", undefined, "ref", "USD"),
    );
    const useCase = new LoadItems({ sessions, unitOfWork: new InMemoryUnitOfWork() });
    const load = (quantity: number, maxLineQuantity?: number | null) =>
      useCase.execute({
        tenantId: "t1",
        checkoutSessionId: "cs-1",
        items: [{ productId: "p1", quantity, unitPriceAmountMinor: 100, currency: "USD" }],
        ...(maxLineQuantity === undefined ? {} : { maxLineQuantity }),
      });
    return { load };
  }

  it("no limit: any quantity loads (today)", async () => {
    const { load } = itemsSetup();
    expect((await load(500)).ok).toBe(true);
    expect((await load(500, null)).ok).toBe(true);
  });

  it("a line over the limit is 422 on `quantity` with the shopper-facing message", async () => {
    const { load } = itemsSetup();
    const result = await load(4, 3);
    expect(fieldsOf(result)).toEqual(["quantity"]);
    if (result.ok) return;
    expect((result.error as ValidationError).fields[0]?.message).toBe(
      "You can add up to 3 of this item",
    );
  });

  it("a line at the limit loads", async () => {
    const { load } = itemsSetup();
    expect((await load(3, 3)).ok).toBe(true);
  });
});
