import { describe, expect, it } from "vitest";
import { buildCustomerFixture, TENANT_A, TENANT_B } from "./customer-profile-test-fixture";
import { SetCustomerTags } from "./set-customer-tags.use-case";

async function setup() {
  const fixture = buildCustomerFixture();
  const useCase = new SetCustomerTags({
    annotations: fixture.annotations,
    unitOfWork: fixture.unitOfWork,
  });
  const customer = await fixture.seedCustomer();
  return { ...fixture, useCase, customer, customerId: customer.id.toString() };
}

describe("SetCustomerTags", () => {
  it("sorts and de-duplicates by key, through the unit of work's tx, without changing the version", async () => {
    expect.hasAssertions();
    const t = await setup();
    const version = t.customer.version;

    const result = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      tags: ["VIP", " vip ", "Cairo"],
    });

    expect(result).toEqual({
      ok: true,
      value: { customerId: t.customerId, tags: ["Cairo", "VIP"] },
    });
    expect(t.customer.version).toBe(version);
    expect(t.saves).toEqual([]);
    expect(t.annotationCalls).toEqual([
      { method: "replaceTags", tx: t.unitOfWork.transactions[0] },
    ]);
  });

  it("replaces the whole set — old tags disappear — and an empty list clears", async () => {
    expect.hasAssertions();
    const t = await setup();
    await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      tags: ["old", "keep"],
    });

    const replaced = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      tags: ["new"],
    });
    expect(replaced).toEqual({ ok: true, value: { customerId: t.customerId, tags: ["new"] } });

    const cleared = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      tags: [],
    });
    expect(cleared).toEqual({ ok: true, value: { customerId: t.customerId, tags: [] } });
    const stored = await t.annotations.annotationsOf([t.customerId], TENANT_A);
    expect(stored.get(t.customerId)?.tags).toEqual([]);
  });

  it("trims, splits Latin and Arabic commas, drops blanks and accepts 40 emoji", async () => {
    expect.hasAssertions();
    const t = await setup();

    const result = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      tags: ["  VIP  ", "a, b، c", " ", "😀".repeat(40)],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect([...result.value.tags].sort()).toEqual(["a", "b", "c", "VIP", "😀".repeat(40)].sort());
      expect(result.value.tags).toHaveLength(5);
    }
  });

  it("rejects a 41-character tag and 251 distinct tags with VALIDATION, accepts 250", async () => {
    expect.hasAssertions();
    const t = await setup();
    const many = (count: number) => Array.from({ length: count }, (_, i) => `t${i}`);

    const longTag = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      tags: ["😀".repeat(41)],
    });
    const over = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      tags: many(251),
    });
    const calls = t.annotationCalls.length;
    const exact = await t.useCase.execute({
      tenantId: TENANT_A,
      customerId: t.customerId,
      tags: many(250),
    });

    for (const result of [longTag, over]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    }
    expect(calls).toBe(0);
    expect(exact.ok).toBe(true);
  });

  it("returns NOT_FOUND for an unknown customer and another tenant's customer", async () => {
    expect.hasAssertions();
    const t = await setup();

    const unknown = await t.useCase.execute({ tenantId: TENANT_A, customerId: "x", tags: ["a"] });
    const otherTenant = await t.useCase.execute({
      tenantId: TENANT_B,
      customerId: t.customerId,
      tags: ["a"],
    });

    for (const result of [unknown, otherTenant]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    }
  });
});
