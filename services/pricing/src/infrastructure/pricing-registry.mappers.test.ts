import { UniqueEntityId } from "@platform/domain";
import { describe, expect, it } from "vitest";
import { PricingRule } from "../domain/pricing-rule";
import { PricingRuleMapper } from "./pricing-registry.mappers";

/**
 * Stands in for a `Prisma.Decimal` instance without adding a `decimal.js` dependency to this
 * package just for a test double — `Number(x)` only needs `valueOf()`/`toString()` to exist,
 * which is all a real `Prisma.Decimal` (decimal.js underneath) and this fake share.
 */
function fakeDecimal(value: string): { toString(): string; valueOf(): string } {
  return { toString: () => value, valueOf: () => value };
}

describe("PricingRuleMapper (WP-11, F-07 — Float -> Decimal)", () => {
  it("toDomain converts a Prisma.Decimal-shaped value to an exact number", () => {
    // Simulates exactly what a real query against the Decimal(19,4) column returns.
    const rule = PricingRuleMapper.toDomain({
      id: "rule-1",
      type: "percentage",
      value: fakeDecimal("12.5000"),
      priority: 1,
      active: true,
      version: 0,
    });

    expect(rule.value).toBe(12.5);
  });

  it("toRow writes the plain number value unchanged (write-once, no accumulator needed)", () => {
    const result = PricingRule.create(
      UniqueEntityId.from("rule-1"),
      "fixed_amount",
      19.99,
      1,
      "e1",
      new Date(),
    );
    if (!result.ok) throw result.error;

    const row = PricingRuleMapper.toRow(result.value, "tenant-1");

    expect(row.value).toBe(19.99);
  });
});
