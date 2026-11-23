import { describe, expect, it } from "vitest";
import type { Database } from "@platform/db";
import { IN_MEMORY_PLATFORM_TENANT, outreachPlatformScope } from "./composition";

const prisma = {} as unknown as Database;

describe("outreachPlatformScope", () => {
  it("the explicit platform tenant wins, then the deployment tenant", () => {
    expect.hasAssertions();
    expect(outreachPlatformScope({ platformTenantId: "plat", tenantId: "shop" })).toBe("plat");
    expect(outreachPlatformScope({ tenantId: "shop" })).toBe("shop");
    expect(outreachPlatformScope({ platformTenantId: "plat", tenantId: "shop", prisma })).toBe(
      "plat",
    );
  });

  it("the in-memory marker is for tests only: with no tenant at all and no database it is the scope", () => {
    expect.hasAssertions();
    expect(outreachPlatformScope({})).toBe(IN_MEMORY_PLATFORM_TENANT);
  });

  it("with a database and nothing to pin to the scope stays blank (the transport then refuses), never the marker", () => {
    expect.hasAssertions();
    expect(outreachPlatformScope({ prisma })).toBe("");
    expect(outreachPlatformScope({ platformTenantId: "", prisma })).toBe("");
  });
});
