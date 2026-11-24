import { describe, expect, it } from "vitest";
import { buildCustomerFixture, TENANT_A, TENANT_B } from "./customer-profile-test-fixture";
import { GetCustomerAnnotations } from "./get-customer-annotations.use-case";

async function setup() {
  const fixture = buildCustomerFixture();
  const useCase = new GetCustomerAnnotations({ annotations: fixture.annotations });
  const one = await fixture.seedCustomer("one@example.com");
  const two = await fixture.seedCustomer("two@example.com");
  const foreign = await fixture.seedCustomer("foreign@example.com", TENANT_B);
  await fixture.annotations.setNote(one.id.toString(), "note one", TENANT_A);
  await fixture.annotations.replaceTags(
    two.id.toString(),
    [
      { tag: "VIP", tagKey: "vip" },
      { tag: "Cairo", tagKey: "cairo" },
    ],
    TENANT_A,
  );
  return {
    ...fixture,
    useCase,
    one: one.id.toString(),
    two: two.id.toString(),
    foreign: foreign.id.toString(),
  };
}

describe("GetCustomerAnnotations", () => {
  it("returns items in input order with sorted tags", async () => {
    expect.hasAssertions();
    const t = await setup();

    const result = await t.useCase.execute({ tenantId: TENANT_A, customerIds: [t.two, t.one] });

    expect(result).toEqual({
      ok: true,
      value: {
        items: [
          { customerId: t.two, note: null, tags: ["Cairo", "VIP"] },
          { customerId: t.one, note: "note one", tags: [] },
        ],
      },
    });
  });

  it("omits unknown ids and another tenant's customer, and reads without opening a unit of work", async () => {
    expect.hasAssertions();
    const t = await setup();

    const result = await t.useCase.execute({
      tenantId: TENANT_A,
      customerIds: ["missing", t.foreign, t.one],
    });

    expect(result).toEqual({
      ok: true,
      value: { items: [{ customerId: t.one, note: "note one", tags: [] }] },
    });
    expect(t.unitOfWork.transactions).toEqual([]);
  });

  it("reads once for the whole set and keeps the first occurrence of a repeated id", async () => {
    expect.hasAssertions();
    const t = await setup();

    const result = await t.useCase.execute({
      tenantId: TENANT_A,
      customerIds: [t.one, t.two, t.one],
    });

    expect(result.ok && result.value.items.map((item) => item.customerId)).toEqual([t.one, t.two]);
    expect(t.annotationCalls.filter((c) => c.method === "annotationsOf")).toHaveLength(1);
  });

  it("accepts 250 ids and rejects 0 and 251 with VALIDATION", async () => {
    expect.hasAssertions();
    const t = await setup();
    const ids = (count: number) => Array.from({ length: count }, (_, i) => `id-${i}`);

    const exact = await t.useCase.execute({ tenantId: TENANT_A, customerIds: ids(250) });
    const empty = await t.useCase.execute({ tenantId: TENANT_A, customerIds: [] });
    const over = await t.useCase.execute({ tenantId: TENANT_A, customerIds: ids(251) });

    expect(exact).toEqual({ ok: true, value: { items: [] } });
    for (const result of [empty, over]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    }
  });
});
