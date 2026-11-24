import { describe, expect, it } from "vitest";
import { ValidationError } from "@platform/utils";
import { buildCustomerFixture, TENANT_A, TENANT_B } from "./customer-profile-test-fixture";
import { SetCustomerNote } from "./set-customer-note.use-case";

async function setup() {
  const fixture = buildCustomerFixture();
  const useCase = new SetCustomerNote({
    annotations: fixture.annotations,
    unitOfWork: fixture.unitOfWork,
  });
  const customer = await fixture.seedCustomer();
  return { ...fixture, useCase, customer, customerId: customer.id.toString() };
}

describe("SetCustomerNote", () => {
  it("trims the note, stores it through the unit of work's tx and never changes the customer version", async () => {
    expect.hasAssertions();
    const t = await setup();
    const version = t.customer.version;

    const result = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      note: "  hi  ",
    });

    expect(result).toEqual({ ok: true, value: { customerId: t.customerId, note: "hi" } });
    expect(t.customer.version).toBe(version);
    expect(t.saves).toEqual([]);
    expect(t.annotationCalls).toEqual([{ method: "setNote", tx: t.unitOfWork.transactions[0] }]);
    const stored = await t.annotations.annotationsOf([t.customerId], TENANT_A);
    expect(stored.get(t.customerId)?.note).toBe("hi");
  });

  it("stores null for a blank note and for null, replacing an earlier note", async () => {
    expect.hasAssertions();
    const t = await setup();
    await t.useCase.execute({ tenantId: TENANT_A, customerId: t.customerId, note: "first" });

    const blank = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      note: "   ",
    });
    expect(blank).toEqual({ ok: true, value: { customerId: t.customerId, note: null } });

    await t.useCase.execute({ tenantId: TENANT_A, customerId: t.customerId, note: "again" });
    const cleared = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      note: null,
    });
    expect(cleared).toEqual({ ok: true, value: { customerId: t.customerId, note: null } });
    const stored = await t.annotations.annotationsOf([t.customerId], TENANT_A);
    expect(stored.get(t.customerId)?.note).toBeNull();
  });

  it("accepts exactly 5000 code points and rejects 5001 with VALIDATION before any write", async () => {
    expect.hasAssertions();
    const t = await setup();

    const exact = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      note: "😀".repeat(5000),
    });
    const calls = t.annotationCalls.length;
    const over = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      note: "😀".repeat(5001),
    });

    expect(exact.ok).toBe(true);
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.error).toBeInstanceOf(ValidationError);
      expect((over.error as ValidationError).fields[0]?.field).toBe("note");
    }
    expect(t.annotationCalls).toHaveLength(calls);
  });

  it("returns NOT_FOUND for an unknown customer and for another tenant's customer", async () => {
    expect.hasAssertions();
    const t = await setup();

    const unknown = await t.useCase.execute({ tenantId: TENANT_A, customerId: "x", note: "n" });
    const otherTenant = await t.useCase.execute({
      tenantId: TENANT_B,
      customerId: t.customerId,
      note: "n",
    });

    for (const result of [unknown, otherTenant]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    }
    const stored = await t.annotations.annotationsOf([t.customerId], TENANT_A);
    expect(stored.get(t.customerId)?.note).toBeNull();
  });
});
