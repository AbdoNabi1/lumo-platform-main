import { describe, expect, it } from "vitest";
import { ValidationError } from "@platform/utils";
import { ConsentScope } from "../domain/value-objects/consent-scope";
import { ChangeMarketingConsent } from "./change-marketing-consent.use-case";
import { buildCustomerFixture, TENANT_A, TENANT_B } from "../testing/customer-profile-fixture";

async function setup() {
  const fixture = buildCustomerFixture();
  const useCase = new ChangeMarketingConsent({
    customers: fixture.customers,
    unitOfWork: fixture.unitOfWork,
    idGenerator: fixture.idGenerator,
    clock: fixture.clock,
  });
  const customer = await fixture.seedCustomer();
  return { ...fixture, useCase, customer, customerId: customer.id.toString() };
}

describe("ChangeMarketingConsent", () => {
  it("accepts marketing_sms as a consent scope", () => {
    expect.hasAssertions();
    expect(ConsentScope.create("marketing_sms").ok).toBe(true);
  });

  it("appends ONE record when {email:true} is sent twice", async () => {
    expect.hasAssertions();
    const t = await setup();

    const first = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      email: true,
    });
    const second = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      email: true,
    });

    expect(first).toEqual({
      ok: true,
      value: { customerId: t.customerId, email: true, sms: false },
    });
    expect(second).toEqual({
      ok: true,
      value: { customerId: t.customerId, email: true, sms: false },
    });
    expect(t.customer.consents).toHaveLength(1);
    expect(t.saves).toHaveLength(1); // the unchanged repeat does not save
    expect(t.outboxTypes().filter((topic) => topic.includes("consent_changed"))).toHaveLength(1);
  });

  it("emits consent.changed with scope marketing_sms for {sms:true}", async () => {
    expect.hasAssertions();
    const t = await setup();

    const result = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      sms: true,
    });

    expect(result).toEqual({
      ok: true,
      value: { customerId: t.customerId, email: false, sms: true },
    });
    expect(t.customer.consents.map((record) => record.scope.value)).toEqual(["marketing_sms"]);
    const events = t.outboxText().filter((text) => text.includes("marketing_sms"));
    expect(events).toHaveLength(1);
    expect(t.outboxTypes().filter((topic) => topic.includes("consent_changed"))).toHaveLength(1);
  });

  it("appends only the channels that changed and saves once, in one unit of work", async () => {
    expect.hasAssertions();
    const t = await setup();
    await t.useCase.execute({ tenantId: TENANT_A, customerId: t.customerId, email: true });
    t.saves.length = 0;
    const transactionsBefore = t.unitOfWork.transactions.length;

    const result = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      email: true, // unchanged
      sms: true, // changed
    });

    expect(result).toEqual({
      ok: true,
      value: { customerId: t.customerId, email: true, sms: true },
    });
    expect(t.customer.consents.map((record) => record.scope.value)).toEqual([
      "marketing",
      "marketing_sms",
    ]);
    expect(t.saves).toHaveLength(1);
    expect(t.unitOfWork.transactions).toHaveLength(transactionsBefore + 1);
  });

  it("revokes independently: {sms:false} leaves email granted", async () => {
    expect.hasAssertions();
    const t = await setup();
    await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      email: true,
      sms: true,
    });

    const result = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      sms: false,
    });

    expect(result).toEqual({
      ok: true,
      value: { customerId: t.customerId, email: true, sms: false },
    });
  });

  it("rejects an empty body with VALIDATION on field body", async () => {
    expect.hasAssertions();
    const t = await setup();

    const result = await t.useCase.execute({ tenantId: TENANT_A, customerId: t.customerId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(ValidationError);
    expect((result.error as ValidationError).fields[0]?.field).toBe("body");
    expect(t.unitOfWork.transactions).toEqual([]);
  });

  it("returns NOT_FOUND for an unknown customer and another tenant's customer", async () => {
    expect.hasAssertions();
    const t = await setup();

    const unknown = await t.useCase.execute({ tenantId: TENANT_A, customerId: "x", email: true });
    const otherTenant = await t.useCase.execute({
      tenantId: TENANT_B,
      customerId: t.customerId,
      email: true,
    });

    for (const result of [unknown, otherTenant]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    }
    expect(t.customer.consents).toHaveLength(0);
  });
});
