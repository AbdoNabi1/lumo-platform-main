import { describe, expect, it } from "vitest";
import { createFakePrisma } from "@platform/db/testing";
import { PrismaStaffDirectoryAdapter } from "./staff-directory.adapter";

describe("PrismaStaffDirectoryAdapter (order operations Part 2)", () => {
  it("reads this shop's principal display name by external id — never another shop's", async () => {
    const fake = createFakePrisma();
    await fake.database.securityPrincipal.create({
      data: { tenantId: "shop-a", externalId: "staff-1", displayName: "Ahmed" } as never,
    });
    await fake.database.securityPrincipal.create({
      data: { tenantId: "shop-b", externalId: "staff-2", displayName: "Other shop" } as never,
    });
    const staff = new PrismaStaffDirectoryAdapter({ prisma: fake.database });

    expect(await staff.displayNameOf("staff-1", "shop-a")).toBe("Ahmed");
    expect(await staff.displayNameOf("staff-2", "shop-a")).toBeNull();
    expect(await staff.displayNameOf("nobody", "shop-a")).toBeNull();
  });
});
