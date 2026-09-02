import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { Customer } from "../domain/customer";
import { Email } from "../domain/value-objects/email";
import { GetCustomer } from "./get-customer.use-case";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function customer(): Customer {
  return Customer.register(
    UniqueEntityId.from("cust-1"),
    must(Email.create("alice@example.com")),
    "Alice",
    "evt-reg",
    new Date(0),
  );
}

const notUsed = async (): Promise<never> => {
  throw new Error("not used by GetCustomer");
};

describe("GetCustomer", () => {
  it("returns the customer when found", async () => {
    const repo = {
      findById: async () => customer(),
      findByEmail: notUsed,
      save: async () => {},
      list: notUsed,
    };
    const useCase = new GetCustomer({ customers: repo });
    const result = await useCase.execute({ customerId: "cust-1" });
    expect(result.ok).toBe(true);
  });

  it("returns 404 when not found", async () => {
    const repo = {
      findById: async () => null,
      findByEmail: notUsed,
      save: async () => {},
      list: notUsed,
    };
    const useCase = new GetCustomer({ customers: repo });
    const result = await useCase.execute({ customerId: "missing" });
    expect(result.ok).toBe(false);
  });
});
