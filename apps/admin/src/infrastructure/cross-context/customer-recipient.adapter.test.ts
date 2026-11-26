import { describe, expect, it } from "vitest";
import { CustomerRecipientResolver } from "./customer-recipient.adapter";
import { guardedTrigger, UnannouncedOrders } from "./notification-trigger";
import { spyLogger } from "./testing/notification-test-support";

describe("CustomerRecipientResolver", () => {
  const ok = (body: unknown) =>
    ({ getCustomer: () => Promise.resolve({ status: 200, body }) }) as never;

  it("reads name, address and language from the customer, in the caller's tenant", async () => {
    expect.hasAssertions();
    const seen: unknown[] = [];
    const resolver = new CustomerRecipientResolver({
      getCustomer: (input: unknown) => {
        seen.push(input);
        return Promise.resolve({
          status: 200,
          body: { name: "Sara", email: { value: "sara@example.com" }, language: "ar" },
        });
      },
    } as never);
    expect(await resolver.resolve("t1", "cust-1")).toEqual({
      name: "Sara",
      email: "sara@example.com",
      language: "ar",
    });
    expect(seen).toEqual([{ tenantId: "t1", customerId: "cust-1" }]);
  });

  it("an unknown, erased or non-id reference resolves to nobody", async () => {
    expect.hasAssertions();
    expect(
      await new CustomerRecipientResolver({
        getCustomer: () => Promise.resolve({ status: 404, body: {} }),
      } as never).resolve("t1", "x"),
    ).toBeNull();
    expect(
      await new CustomerRecipientResolver({
        getCustomer: () => Promise.reject(new Error("invalid uuid")),
      } as never).resolve("t1", "free-text-ref"),
    ).toBeNull();
    expect(
      await new CustomerRecipientResolver(ok({})).resolve("t1", "x").catch(() => "threw"),
    ).toBeDefined();
  });
});

describe("guardedTrigger", () => {
  it("runs the work, swallows a throw and logs only the trigger, the references and a short reason", async () => {
    expect.hasAssertions();
    const log = spyLogger();
    await expect(
      guardedTrigger("t", { tenantId: "t1", orderRef: "o1" }, () => {
        throw Object.assign(new Error("boom a@b.test"), { name: "BoomError" });
      }),
    ).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith("notification trigger failed", {
      trigger: "t",
      tenantId: "t1",
      orderRef: "o1",
      reason: "BoomError",
    });
    expect(log.dumped()).not.toContain("a@b.test");
    log.restore();
  });
});

describe("UnannouncedOrders", () => {
  it("marks and clears an order id", () => {
    expect.hasAssertions();
    const registry = new UnannouncedOrders();
    registry.mark("o1");
    expect(registry.has("o1")).toBe(true);
    registry.clear("o1");
    expect(registry.has("o1")).toBe(false);
  });
});
