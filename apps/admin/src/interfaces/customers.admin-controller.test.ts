import type {
  AccessControl,
  AuditEvent,
  AuditTrail,
  Permission,
  Principal,
} from "@platform/contracts";
import type { CustomerController } from "@platform/identity";
import { describe, expect, it, vi } from "vitest";
import { AdminGuard } from "./admin-guard";
import { CustomersAdminController } from "./customers.admin-controller";

const staff: Principal = { id: "staff-1", kind: "staff", roles: [], tenantId: "t-1" };

function guardAnswering(allowed: boolean): { guard: AdminGuard; asked: Permission[] } {
  const asked: Permission[] = [];
  const accessControl: AccessControl = {
    authorize: async (_principal, permission) => {
      asked.push(permission);
      return allowed;
    },
  };
  const auditTrail: AuditTrail = { record: async (_entry: AuditEvent) => undefined };
  return {
    guard: new AdminGuard({ accessControl, auditTrail, clock: { now: () => new Date(0) } }),
    asked,
  };
}

describe("CustomersAdminController.contactsOfCustomers (Plan 3D: names on the orders list)", () => {
  it("asks for orders:read, not customers:read, and reads the whole set in one call", async () => {
    const { guard, asked } = guardAnswering(true);
    const customerContacts = vi.fn().mockResolvedValue({ status: 200, body: [] });
    const target = new CustomersAdminController({
      customers: { customerContacts } as unknown as CustomerController,
      guard,
    });

    const response = await target.contactsOfCustomers(staff, {
      tenantId: "t-1",
      customerIds: ["c-1", "c-2"],
    });

    expect(response.status).toBe(200);
    expect(asked).toEqual(["orders:read"]);
    expect(customerContacts).toHaveBeenCalledTimes(1);
    expect(customerContacts).toHaveBeenCalledWith({ tenantId: "t-1", customerIds: ["c-1", "c-2"] });
  });

  it("never reaches Identity when the caller may not read orders", async () => {
    const { guard } = guardAnswering(false);
    const customerContacts = vi.fn();
    const target = new CustomersAdminController({
      customers: { customerContacts } as unknown as CustomerController,
      guard,
    });

    const response = await target.contactsOfCustomers(staff, {
      tenantId: "t-1",
      customerIds: ["c-1"],
    });

    expect(response.status).toBe(403);
    expect(customerContacts).not.toHaveBeenCalled();
  });
});

describe("CustomersAdminController Wave 1b writes and export (guards first)", () => {
  const writes = [
    ["createCustomer", "createCustomer", "customers:register"],
    ["updateCustomerProfile", "updateCustomerProfile", "customers:update"],
    ["setCustomerNote", "setCustomerNote", "customers:update"],
    ["setCustomerTags", "setCustomerTags", "customers:update"],
    ["changeMarketingConsent", "changeMarketingConsent", "customers:change_consent"],
    ["customerAnnotations", "customerAnnotations", "customers:read"],
  ] as const;

  it.each(writes)(
    "%s asks for %s's permission, then delegates exactly once",
    async (method, identityMethod, permission) => {
      expect.hasAssertions();
      const { guard, asked } = guardAnswering(true);
      const fn = vi.fn().mockResolvedValue({ status: 200, body: { ok: true } });
      const target = new CustomersAdminController({
        customers: { [identityMethod]: fn } as unknown as CustomerController,
        guard,
      });
      const input = { tenantId: "t-1" } as never;

      const response = await target[method](staff, input);

      expect(response.status).toBe(200);
      expect(asked).toEqual([permission]);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(input);
    },
  );

  it.each(writes)("%s never reaches Identity when denied (403)", async (method, identityMethod) => {
    expect.hasAssertions();
    const { guard } = guardAnswering(false);
    const fn = vi.fn();
    const target = new CustomersAdminController({
      customers: { [identityMethod]: fn } as unknown as CustomerController,
      guard,
    });

    const response = await target[method](staff, { tenantId: "t-1" } as never);

    expect(response.status).toBe(403);
    expect(fn).not.toHaveBeenCalled();
  });

  it("exportCustomers asks for customers:export, lists, then reads the page's annotations once", async () => {
    expect.hasAssertions();
    const { guard, asked } = guardAnswering(true);
    const customer = { id: { toString: () => "c-1" } };
    const listCustomers = vi.fn().mockResolvedValue({
      status: 200,
      body: { items: [customer], pageInfo: { hasNextPage: false, endCursor: "c-1" } },
    });
    const customerAnnotations = vi.fn().mockResolvedValue({
      status: 200,
      body: { items: [{ customerId: "c-1", note: "hi", tags: ["VIP"] }] },
    });
    const target = new CustomersAdminController({
      customers: { listCustomers, customerAnnotations } as unknown as CustomerController,
      guard,
    });

    const response = await target.exportCustomers(staff, { tenantId: "t-1", first: 100 });

    expect(asked).toEqual(["customers:export"]);
    expect(listCustomers).toHaveBeenCalledWith({ tenantId: "t-1", first: 100 });
    expect(customerAnnotations).toHaveBeenCalledWith({ tenantId: "t-1", customerIds: ["c-1"] });
    expect(response).toEqual({
      status: 200,
      body: {
        items: [{ customer, note: "hi", tags: ["VIP"] }],
        pageInfo: { hasNextPage: false, endCursor: "c-1" },
      },
    });
  });

  it("exportCustomers skips the annotations read for an empty page", async () => {
    expect.hasAssertions();
    const { guard } = guardAnswering(true);
    const listCustomers = vi.fn().mockResolvedValue({
      status: 200,
      body: { items: [], pageInfo: { hasNextPage: false, endCursor: null } },
    });
    const customerAnnotations = vi.fn();
    const target = new CustomersAdminController({
      customers: { listCustomers, customerAnnotations } as unknown as CustomerController,
      guard,
    });

    const response = await target.exportCustomers(staff, { tenantId: "t-1" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    expect(customerAnnotations).not.toHaveBeenCalled();
  });

  it("exportCustomers returns a failed annotations read as is (no partial rows)", async () => {
    expect.hasAssertions();
    const { guard } = guardAnswering(true);
    const failure = { status: 500, body: { code: "UNEXPECTED" } };
    const target = new CustomersAdminController({
      customers: {
        listCustomers: vi.fn().mockResolvedValue({
          status: 200,
          body: { items: [{ id: { toString: () => "c-1" } }], pageInfo: {} },
        }),
        customerAnnotations: vi.fn().mockResolvedValue(failure),
      } as unknown as CustomerController,
      guard,
    });

    expect(await target.exportCustomers(staff, { tenantId: "t-1" })).toBe(failure);
  });

  it("exportCustomers returns a failed list as is and never reads annotations", async () => {
    expect.hasAssertions();
    const { guard } = guardAnswering(true);
    const failure = { status: 422, body: { code: "VALIDATION" } };
    const customerAnnotations = vi.fn();
    const target = new CustomersAdminController({
      customers: {
        listCustomers: vi.fn().mockResolvedValue(failure),
        customerAnnotations,
      } as unknown as CustomerController,
      guard,
    });

    expect(await target.exportCustomers(staff, { tenantId: "t-1" })).toBe(failure);
    expect(customerAnnotations).not.toHaveBeenCalled();
  });

  it("exportCustomers never reaches Identity without customers:export", async () => {
    expect.hasAssertions();
    const { guard } = guardAnswering(false);
    const listCustomers = vi.fn();
    const target = new CustomersAdminController({
      customers: { listCustomers } as unknown as CustomerController,
      guard,
    });

    expect((await target.exportCustomers(staff, { tenantId: "t-1" })).status).toBe(403);
    expect(listCustomers).not.toHaveBeenCalled();
  });
});
