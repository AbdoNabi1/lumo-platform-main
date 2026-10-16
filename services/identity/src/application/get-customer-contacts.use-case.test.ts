import { describe, expect, it, vi } from "vitest";
import type { CustomerContact, CustomerContactReader } from "../domain/customer-repository";
import { GetCustomerContacts } from "./get-customer-contacts.use-case";

function repositoryAnswering(contacts: readonly CustomerContact[]) {
  const findContactsByIds = vi.fn().mockResolvedValue(contacts);
  const customers = { findContactsByIds } as CustomerContactReader;
  return { customers, findContactsByIds };
}

describe("GetCustomerContacts", () => {
  it("reads the distinct ids in ONE call, in the callers tenant", async () => {
    const { customers, findContactsByIds } = repositoryAnswering([
      { id: "c-1", name: "Alice", email: "alice@example.com", isGuest: false },
    ]);

    const result = await new GetCustomerContacts({ customers }).execute({
      tenantId: "tenant-a",
      customerIds: ["c-1", "c-2", "c-1", "c-2", "c-3"],
    });

    expect(findContactsByIds).toHaveBeenCalledTimes(1);
    expect(findContactsByIds).toHaveBeenCalledWith(["c-1", "c-2", "c-3"], "tenant-a");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        { id: "c-1", name: "Alice", email: "alice@example.com", isGuest: false },
      ]);
    }
  });

  it("does not read anything for no ids", async () => {
    const { customers, findContactsByIds } = repositoryAnswering([]);

    const result = await new GetCustomerContacts({ customers }).execute({
      tenantId: "tenant-a",
      customerIds: [],
    });

    expect(findContactsByIds).not.toHaveBeenCalled();
    expect(result.ok && result.value).toEqual([]);
  });
});
