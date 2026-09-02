import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import type { Paginated } from "@platform/types";
import type { Customer } from "../domain/customer";
import type { CustomerListQuery } from "../domain/customer-repository";
import { Email } from "../domain/value-objects/email";
import { Customer as CustomerAggregate } from "../domain/customer";
import { ListCustomers } from "./list-customers.use-case";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function customer(id: string, name: string, email: string): Customer {
  return CustomerAggregate.register(
    UniqueEntityId.from(id),
    must(Email.create(email)),
    name,
    `evt-${id}`,
    new Date(0),
  );
}

const notUsed = async (): Promise<never> => {
  throw new Error("not used by ListCustomers");
};

describe("ListCustomers", () => {
  it("delegates the page request straight to the repository", async () => {
    const page: Paginated<Customer> = {
      items: [customer("cust-1", "Alice", "alice@example.com")],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
    let received: CustomerListQuery | undefined;
    const repo = {
      findById: notUsed,
      findByEmail: notUsed,
      save: async () => {},
      list: async (query: CustomerListQuery) => {
        received = query;
        return page;
      },
    };
    const useCase = new ListCustomers({ customers: repo });
    const result = await useCase.execute({ first: 20, search: "alice" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(page);
    }
    expect(received).toEqual({ first: 20, search: "alice" });
  });

  it("returns an empty page when nothing matches", async () => {
    const repo = {
      findById: notUsed,
      findByEmail: notUsed,
      save: async () => {},
      list: async () => ({ items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
    };
    const useCase = new ListCustomers({ customers: repo });
    const result = await useCase.execute({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(0);
    }
  });
});
