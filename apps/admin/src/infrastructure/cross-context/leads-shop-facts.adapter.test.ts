import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@platform/utils";
import { tenancyShopFacts } from "./leads-shop-facts.adapter";

beforeEach(() => {
  expect.hasAssertions();
});

const answers = (status: number, body: unknown) => () => Promise.resolve({ status, body });

describe("tenancyShopFacts (Leads' read of the shop's own facts)", () => {
  it("reads the site type and currency from tenancy's public store view, per tenant", async () => {
    const asked: string[] = [];
    const facts = tenancyShopFacts((tenantId) => {
      asked.push(tenantId);
      return Promise.resolve({
        status: 200,
        body: { name: "Clinic", currency: "SAR", siteType: "lead_site" },
      });
    });
    expect(await facts.siteTypeOf("t-9")).toBe("lead_site");
    expect(await facts.currencyOf("t-9")).toBe("SAR");
    expect(asked).toEqual(["t-9", "t-9"]);
  });

  it.each([
    ["a rejected read", () => Promise.reject(new Error("db down"))],
    ["a non-200 answer", answers(404, null)],
    ["a 200 with no body", answers(200, null)],
    ["an unknown site type", answers(200, { currency: "EGP", siteType: "marketplace" })],
    ["a missing site type", answers(200, { currency: "EGP" })],
    ["a non-string currency", answers(200, { currency: 20, siteType: "store" })],
  ])("%s throws UNAVAILABLE (never a guess)", async (_label, read) => {
    const facts = tenancyShopFacts(read);
    for (const ask of [facts.siteTypeOf("t-1"), facts.currencyOf("t-1")]) {
      await expect(ask).rejects.toBeInstanceOf(AppError);
      await expect(ask).rejects.toMatchObject({
        code: "UNAVAILABLE",
        message: "shop facts unavailable",
      });
    }
  });
});
