import { UniqueEntityId } from "@platform/domain";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { Credit } from "../domain/credit";
import { UsageCounter } from "../domain/usage-counter";
import { CreditMapper, UsageCounterMapper } from "./mappers";

const ID = UniqueEntityId.from("row-1");

describe("UsageCounterMapper (WP-11, F-07)", () => {
  it("toRow writes the exact decimal string, never a JS number", () => {
    const counter = UsageCounter.create(ID, "tenant-1", "api_calls", "e1", new Date());
    counter.recordUsage(19.9999, "gb", new Date(), "e2");

    const row = UsageCounterMapper.toRow(counter, "tenant-1");

    expect(row.amount).toBe("19.9999");
    expect(typeof row.amount).toBe("string");
  });

  it("toDomain round-trips a Prisma.Decimal-shaped value (decimal.js instance) with no precision loss", () => {
    // `Prisma.Decimal` IS a decimal.js `Decimal` under the hood — this simulates exactly what a
    // real query against the Decimal(19,4) column returns, not just a string.
    const counter = UsageCounterMapper.toDomain({
      id: "row-1",
      tenantRef: "tenant-1",
      resource: "api_calls",
      amount: new Decimal("19.9999"),
      unit: "gb",
      lastRecordedAt: null,
      version: 1,
    });

    expect(counter.amount).toBe(19.9999);
    expect(counter.amountDecimalString).toBe("19.9999");
  });
});

describe("CreditMapper (WP-11, F-07)", () => {
  it("toRow writes the exact decimal string, never a JS number", () => {
    const credit = Credit.grant(ID, "tenant-1", 19.9999, "promo", "e1", new Date());

    const row = CreditMapper.toRow(credit, "tenant-1");

    expect(row.amount).toBe("19.9999");
    expect(typeof row.amount).toBe("string");
  });

  it("toDomain round-trips a Prisma.Decimal-shaped value with no precision loss", () => {
    const credit = CreditMapper.toDomain({
      id: "row-1",
      tenantRef: "tenant-1",
      amount: new Decimal("19.9999"),
      reason: "promo",
      status: "granted",
      version: 0,
    });

    expect(credit.amount).toBe(19.9999);
    expect(credit.amountDecimalString).toBe("19.9999");
  });
});
