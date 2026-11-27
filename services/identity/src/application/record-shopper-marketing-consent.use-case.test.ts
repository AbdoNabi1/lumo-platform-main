import { describe, expect, it } from "vitest";
import { ValidationError } from "@platform/utils";
import { ConsentScope } from "../domain/value-objects/consent-scope";
import { ChangeMarketingConsent } from "./change-marketing-consent.use-case";
import {
  RecordShopperMarketingConsent,
  SHOPPER_CHECKOUT_CONSENT_SOURCE,
} from "./record-shopper-marketing-consent.use-case";
import { buildCustomerFixture, TENANT_A, TENANT_B } from "../testing/customer-profile-fixture";

async function setup() {
  const fixture = buildCustomerFixture();
  const deps = {
    customers: fixture.customers,
    unitOfWork: fixture.unitOfWork,
    idGenerator: fixture.idGenerator,
    clock: fixture.clock,
  };
  const useCase = new RecordShopperMarketingConsent(deps);
  const staff = new ChangeMarketingConsent(deps);
  const customer = await fixture.seedCustomer();
  return { ...fixture, useCase, staff, customer, customerId: customer.id.toString() };
}

const input = (customerId: string, tenantId = TENANT_A) => ({
  tenantId,
  customerId,
  granted: true as const,
  source: "checkout" as const,
  checkoutId: "checkout-1",
});

describe("RecordShopperMarketingConsent", () => {
  it("writes ONE marketing grant whose source says the shopper did it at checkout", async () => {
    expect.hasAssertions();
    const t = await setup();

    const result = await t.useCase.execute(input(t.customerId));

    expect(result).toEqual({ ok: true, value: { customerId: t.customerId, recorded: true } });
    const scope = ConsentScope.create("marketing");
    expect(scope.ok && t.customer.consentFor(scope.value)).toBe(true);
    expect(t.customer.consents).toHaveLength(1);
    expect(t.customer.consents[0]?.scope.value).toBe("marketing");
    expect(t.customer.consents[0]?.granted).toBe(true);
    expect(t.customer.consents[0]?.source).toBe(SHOPPER_CHECKOUT_CONSENT_SOURCE);
    expect(SHOPPER_CHECKOUT_CONSENT_SOURCE).toBe("shopper/checkout");
    const events = t.outboxText().filter((text) => text.includes("shopper/checkout"));
    expect(events).toHaveLength(1);
    expect(t.outboxTypes().filter((topic) => topic.includes("consent_changed"))).toHaveLength(1);
  });

  it("the staff assertion carries no shopper source (the two stay distinguishable)", async () => {
    expect.hasAssertions();
    const t = await setup();

    await t.staff.execute({ tenantId: TENANT_A, customerId: t.customerId, email: true });

    expect(t.customer.consents[0]?.source).toBeUndefined();
    expect(t.outboxText().filter((text) => text.includes("shopper/checkout"))).toHaveLength(0);
  });

  it("is idempotent: a customer who already agreed gets no second record or save", async () => {
    expect.hasAssertions();
    const t = await setup();
    await t.useCase.execute(input(t.customerId));
    t.saves.length = 0;

    const again = await t.useCase.execute(input(t.customerId));

    expect(again).toEqual({ ok: true, value: { customerId: t.customerId, recorded: false } });
    expect(t.customer.consents).toHaveLength(1);
    expect(t.saves).toHaveLength(0);
  });

  it("never touches the SMS channel", async () => {
    expect.hasAssertions();
    const t = await setup();

    await t.useCase.execute(input(t.customerId));

    expect(t.customer.consents.map((record) => record.scope.value)).toEqual(["marketing"]);
  });

  it("an unknown customer, or one of another shop, is 404", async () => {
    expect.hasAssertions();
    const t = await setup();

    const unknown = await t.useCase.execute(input("nope"));
    const otherShop = await t.useCase.execute(input(t.customerId, TENANT_B));

    expect(unknown.ok).toBe(false);
    expect(otherShop.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe("NOT_FOUND");
    if (!otherShop.ok) expect(otherShop.error.code).toBe("NOT_FOUND");
    expect(t.customer.consents).toHaveLength(0);
  });

  it("refuses anything but a checkout grant with a checkout id", async () => {
    expect.hasAssertions();
    const t = await setup();

    const result = await t.useCase.execute({
      ...input(t.customerId),
      granted: false as unknown as true,
      source: "staff" as unknown as "checkout",
      checkoutId: "",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect((result.error as ValidationError).fields.map((f) => f.field)).toEqual([
        "granted",
        "source",
        "checkoutId",
      ]);
    }
    expect(t.customer.consents).toHaveLength(0);
  });
});
