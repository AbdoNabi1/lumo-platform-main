import type {
  AccessControl,
  AuditEvent,
  AuditTrail,
  Permission,
  Principal,
} from "@platform/contracts";
import type { TenancyController } from "@platform/tenancy";
import { describe, expect, it, vi } from "vitest";
import { AdminGuard } from "./admin-guard";
import { TenancyAdminController } from "./tenancy.admin-controller";

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

function controllerWith(guard: AdminGuard, getStoreSettings: ReturnType<typeof vi.fn>) {
  return new TenancyAdminController({
    tenancy: { getStoreSettings } as unknown as TenancyController,
    guard,
  });
}

describe("TenancyAdminController.getStoreRegion (Plan 3D: the zone and currency the dashboard counts in)", () => {
  it("asks for orders:read, not settings:read, and answers only the time zone and the currency", async () => {
    const { guard, asked } = guardAnswering(true);
    const getStoreSettings = vi.fn().mockResolvedValue({
      status: 200,
      body: {
        storeName: "Secret Shop",
        contactEmail: "owner@example.com",
        currency: "EGP",
        timezone: "Africa/Cairo",
        weightUnit: "kg",
      },
    });

    const response = await controllerWith(guard, getStoreSettings).getStoreRegion(staff);

    expect(asked).toEqual(["orders:read"]);
    expect(response).toEqual({
      status: 200,
      body: { currency: "EGP", timezone: "Africa/Cairo" },
    });
  });

  it("never reaches the settings when the caller may not read orders", async () => {
    const { guard } = guardAnswering(false);
    const getStoreSettings = vi.fn();

    const response = await controllerWith(guard, getStoreSettings).getStoreRegion(staff);

    expect(response.status).toBe(403);
    expect(getStoreSettings).not.toHaveBeenCalled();
  });

  it("answers a failed settings read as it is, never a guessed zone", async () => {
    const { guard } = guardAnswering(true);
    const getStoreSettings = vi.fn().mockResolvedValue({ status: 500, body: { message: "down" } });

    const response = await controllerWith(guard, getStoreSettings).getStoreRegion(staff);

    expect(response.status).toBe(500);
  });
});
