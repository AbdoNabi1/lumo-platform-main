import { describe, expect, it, vi } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { logger } from "@platform/utils";
import { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import {
  DEFAULT_CHECKOUT_SETTINGS,
  type CheckoutSettingsValues,
} from "../domain/checkout-settings";
import { CheckoutAddress } from "../domain/value-objects/checkout-address";
import { CheckoutItem } from "../domain/value-objects/checkout-item";
import { CheckoutSessionMapper } from "../infrastructure/checkout-session.mapper";
import { InMemoryCheckoutSettingsRepository } from "../infrastructure/in-memory-checkout-settings-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { SetContactEmail } from "./checkout-details.use-cases";
import { CompleteCheckout } from "./complete-checkout.use-case";
import type { OrderCreationPort, ShopperMarketingConsentPort } from "./ports";

/** Wave 2a (D35): the marketing box at checkout, and the consent it becomes once the order exists. */

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

const base = {
  name: "Mona",
  phone: "01000000000",
  line1: "1 Main St",
  city: "Springfield",
  postalCode: "00000",
  country: "US",
};
const settingsWith = (patch: Partial<CheckoutSettingsValues>): CheckoutSettingsValues => ({
  ...DEFAULT_CHECKOUT_SETTINGS,
  ...patch,
});
function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

describe("SetContactEmail keeps the marketing answer only while the shop shows the prompt", () => {
  function setup(customerRef: string | undefined = undefined) {
    const sessions = new FakeSessions();
    const session = CheckoutSession.start(
      UniqueEntityId.from("cs-1"),
      "cart-1",
      customerRef,
      "ref",
      "USD",
    );
    sessions.seed(session);
    const settings = new InMemoryCheckoutSettingsRepository();
    const useCase = new SetContactEmail({
      sessions,
      unitOfWork: new InMemoryUnitOfWork(),
      settings,
    });
    const set = (extra: { marketingOptIn?: boolean; tenantId?: string } = {}) =>
      useCase.execute({
        tenantId: extra.tenantId ?? "t1",
        checkoutSessionId: "cs-1",
        email: "shopper@example.com",
        ...(extra.marketingOptIn === undefined ? {} : { marketingOptIn: extra.marketingOptIn }),
      });
    return { session, settings, set };
  }

  it("no settings row (the default prompt is hidden): the answer is ignored, the email still saved", async () => {
    const { session, set } = setup();
    expect((await set({ marketingOptIn: true })).ok).toBe(true);
    expect(session.marketingOptIn).toBeUndefined();
    expect(session.contactEmail?.value).toBe("shopper@example.com");
  });

  it("prompt hidden (saved): a forged true is ignored", async () => {
    const { session, settings, set } = setup();
    await settings.save("t1", settingsWith({ marketingEmailPrompt: "hidden" }), null);
    await set({ marketingOptIn: true });
    expect(session.marketingOptIn).toBeUndefined();
  });

  it("prompt show: true is stored, a later false replaces it, and no answer leaves it alone", async () => {
    const { session, settings, set } = setup();
    await settings.save("t1", settingsWith({ marketingEmailPrompt: "show" }), null);
    await set({ marketingOptIn: true });
    expect(session.marketingOptIn).toBe(true);
    await set();
    expect(session.marketingOptIn).toBe(true);
    await set({ marketingOptIn: false });
    expect(session.marketingOptIn).toBe(false);
  });

  it("prompt preselect: the shopper's answer is stored the same way", async () => {
    const { session, settings, set } = setup();
    await settings.save("t1", settingsWith({ marketingEmailPrompt: "preselect" }), null);
    await set({ marketingOptIn: true });
    expect(session.marketingOptIn).toBe(true);
  });

  it("another shop's prompt does not apply", async () => {
    const { session, settings, set } = setup();
    await settings.save("t2", settingsWith({ marketingEmailPrompt: "show" }), null);
    await set({ marketingOptIn: true });
    expect(session.marketingOptIn).toBeUndefined();
  });
});

describe("the marketing answer survives the persistence mapping", () => {
  it("is written as a nullable column and read back (null = never asked)", () => {
    const session = CheckoutSession.start(
      UniqueEntityId.from("cs-1"),
      "cart-1",
      undefined,
      "ref",
      "USD",
    );
    expect(CheckoutSessionMapper.toRow(session, "t1").marketingOptIn).toBeNull();
    session.setMarketingOptIn(true);
    const row = CheckoutSessionMapper.toRow(session, "t1");
    expect(row.marketingOptIn).toBe(true);
    const back = CheckoutSessionMapper.toDomain({ ...row, version: 1 } as never);
    expect(back.marketingOptIn).toBe(true);
    const never = CheckoutSessionMapper.toDomain({
      ...row,
      marketingOptIn: null,
      version: 1,
    } as never);
    expect(never.marketingOptIn).toBeUndefined();
    const legacy = { ...row, version: 1 } as Record<string, unknown>;
    delete legacy["marketingOptIn"];
    expect(CheckoutSessionMapper.toDomain(legacy as never).marketingOptIn).toBeUndefined();
  });
});

describe("complete records the shopper's marketing consent (best effort)", () => {
  const ids: IdGenerator = (() => {
    let n = 0;
    return { generate: () => `evt-${(n += 1)}` };
  })();
  const clock: Clock = { now: () => new Date("2026-11-26T00:00:00.000Z") };

  function setup(opts: {
    customerRef?: string;
    optIn?: boolean;
    resolvedCustomer?: string;
    consent?: ShopperMarketingConsentPort | "none";
  }) {
    const sessions = new FakeSessions();
    const session = CheckoutSession.start(
      UniqueEntityId.from("cs-1"),
      "cart-1",
      opts.customerRef,
      "ref",
      "USD",
    );
    session.loadItems([must(CheckoutItem.create("product-1", 1, 1000, "USD"))]);
    session.setBillingAddress(must(CheckoutAddress.create(base)));
    session.setShippingAddress(must(CheckoutAddress.create(base)));
    if (opts.optIn !== undefined) session.setMarketingOptIn(opts.optIn);
    session.recalculateTotals("evt-t", new Date(0));
    session.pullDomainEvents();
    sessions.seed(session);
    const recorded: { tenantId: string; customerRef: string; checkoutSessionId: string }[] = [];
    const consent: ShopperMarketingConsentPort = {
      record: async (input) => {
        recorded.push(input);
      },
    };
    const orderCreation: OrderCreationPort = {
      create: async () => ({
        orderRef: "order-1",
        ...(opts.resolvedCustomer === undefined ? {} : { customerRef: opts.resolvedCustomer }),
      }),
    };
    const marketingConsent = opts.consent === "none" ? undefined : (opts.consent ?? consent);
    const useCase = new CompleteCheckout({
      sessions,
      unitOfWork: new InMemoryUnitOfWork(),
      idGenerator: ids,
      clock,
      orderCreation,
      ...(marketingConsent === undefined ? {} : { marketingConsent }),
    });
    const complete = () =>
      useCase.execute({ tenantId: "t1", checkoutSessionId: "cs-1", idempotencyKey: "idem-1" });
    return { recorded, complete, session };
  }

  it("ticked, signed in: one consent for that customer, naming the checkout", async () => {
    const t = setup({ customerRef: "customer-1", optIn: true });
    const result = await t.complete();
    expect(result.ok).toBe(true);
    expect(t.recorded).toEqual([
      { tenantId: "t1", customerRef: "customer-1", checkoutSessionId: "cs-1" },
    ]);
  });

  it("ticked, guest: the customer the order resolved from the email gets it", async () => {
    const t = setup({ optIn: true, resolvedCustomer: "guest-customer-9" });
    expect((await t.complete()).ok).toBe(true);
    expect(t.recorded).toEqual([
      { tenantId: "t1", customerRef: "guest-customer-9", checkoutSessionId: "cs-1" },
    ]);
  });

  it("unticked (false) or never answered: nothing is recorded", async () => {
    const unticked = setup({ customerRef: "customer-1", optIn: false });
    const silent = setup({ customerRef: "customer-1" });
    expect((await unticked.complete()).ok).toBe(true);
    expect((await silent.complete()).ok).toBe(true);
    expect(unticked.recorded).toEqual([]);
    expect(silent.recorded).toEqual([]);
  });

  it("ticked guest with no customer to attach it to: nothing is recorded, logged at info, order stands", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const t = setup({ optIn: true });
    const result = await t.complete();
    expect(result.ok && result.value.orderRef).toBe("order-1");
    expect(t.recorded).toEqual([]);
    expect(info).toHaveBeenCalledWith(
      "marketing opt-in ticked but no customer to record it for",
      expect.objectContaining({ tenantId: "t1", checkoutSessionId: "cs-1" }),
    );
    info.mockRestore();
  });

  it("a consent that fails never fails the order: warn logged, the order is placed and completed", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const t = setup({
      customerRef: "customer-1",
      optIn: true,
      consent: {
        record: async () => {
          throw new Error("identity is down");
        },
      },
    });
    const result = await t.complete();
    expect(result.ok && result.value).toEqual({
      checkoutSessionId: "cs-1",
      state: "completed",
      orderRef: "order-1",
    });
    expect(warn).toHaveBeenCalledWith(
      "could not record the shopper's marketing consent",
      expect.objectContaining({ error: "identity is down" }),
    );
    warn.mockRestore();
  });

  it("with no consent port wired (any earlier caller) a ticked box changes nothing", async () => {
    const t = setup({ customerRef: "customer-1", optIn: true, consent: "none" });
    expect((await t.complete()).ok).toBe(true);
    expect(t.recorded).toEqual([]);
  });
});
