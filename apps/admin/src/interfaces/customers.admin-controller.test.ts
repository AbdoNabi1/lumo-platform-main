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
