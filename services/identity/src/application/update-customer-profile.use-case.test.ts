import { describe, expect, it } from "vitest";
import { ValidationError } from "@platform/utils";
import { buildCustomerFixture, TENANT_A, TENANT_B } from "./customer-profile-test-fixture";
import { UpdateCustomerProfile } from "./update-customer-profile.use-case";

async function setup() {
  const fixture = buildCustomerFixture();
  const useCase = new UpdateCustomerProfile({
    customers: fixture.customers,
    unitOfWork: fixture.unitOfWork,
  });
  const customer = await fixture.seedCustomer();
  customer.updateProfile({ phone: "01012345678", language: "en" });
  return { ...fixture, useCase, customer, customerId: customer.id.toString() };
}

describe("UpdateCustomerProfile", () => {
  it("changes only the provided keys and saves through the repository in one unit of work", async () => {
    expect.hasAssertions();
    const t = await setup();

    const result = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      name: "  New Name ",
      language: "ar",
    });

    expect(result).toEqual({ ok: true, value: { customerId: t.customerId } });
    expect(t.customer.name).toBe("New Name");
    expect(t.customer.language).toBe("ar");
    expect(t.customer.phone).toBe("01012345678"); // omitted = unchanged
    expect(t.saves).toHaveLength(1);
    expect(t.unitOfWork.transactions).toHaveLength(1);
    expect(t.saves[0]?.tx).toBe(t.unitOfWork.transactions[0]);
  });

  it("clears the phone with null and with a blank string, and keeps it when omitted", async () => {
    expect.hasAssertions();
    const t = await setup();

    await t.useCase.execute({ tenantId: TENANT_A, customerId: t.customerId, language: null });
    expect(t.customer.phone).toBe("01012345678");
    expect(t.customer.language).toBeNull();

    await t.useCase.execute({ tenantId: TENANT_A, customerId: t.customerId, phone: null });
    expect(t.customer.phone).toBeNull();

    t.customer.updateProfile({ phone: "01012345678" });
    await t.useCase.execute({ tenantId: TENANT_A, customerId: t.customerId, phone: "" });
    expect(t.customer.phone).toBeNull();
  });

  it("rejects an empty body with VALIDATION on field body, without touching the repository", async () => {
    expect.hasAssertions();
    const t = await setup();

    const result = await t.useCase.execute({ tenantId: TENANT_A, customerId: t.customerId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(ValidationError);
    expect((result.error as ValidationError).fields).toEqual([
      { field: "body", message: "provide at least one field" },
    ]);
    expect(t.unitOfWork.transactions).toEqual([]);
    expect(t.saves).toEqual([]);
  });

  it("returns every failing field in ONE ValidationError: empty name, 256-code-point name, phone, language", async () => {
    expect.hasAssertions();
    const t = await setup();

    const combined = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      name: "",
      phone: "12345",
      language: "fr" as never,
    });
    const tooLong = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      name: "😀".repeat(256),
    });
    const nullName = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      name: null as never,
    });

    expect(combined.ok).toBe(false);
    if (!combined.ok) {
      expect((combined.error as ValidationError).fields.map((issue) => issue.field)).toEqual([
        "name",
        "phone",
        "language",
      ]);
    }
    expect(tooLong.ok).toBe(false);
    expect(nullName.ok).toBe(false);
    expect(t.saves).toEqual([]);
    expect(t.customer.name).toBe("Seed");
  });

  it("returns NOT_FOUND for an unknown id and for another tenant's customer", async () => {
    expect.hasAssertions();
    const t = await setup();

    const unknown = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: "missing",
      name: "X",
    });
    const otherTenant = await t.useCase.execute({
      tenantId: TENANT_B,
      customerId: t.customerId,
      name: "X",
    });

    for (const result of [unknown, otherTenant]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    }
    expect(t.customer.name).toBe("Seed");
    expect(t.saves).toEqual([]);
  });
});
