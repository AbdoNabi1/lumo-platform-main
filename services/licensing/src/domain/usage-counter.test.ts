import { UniqueEntityId } from "@platform/domain";
import { describe, expect, it } from "vitest";
import { UsageCounter } from "./usage-counter";

const ID = UniqueEntityId.from("counter-1");
const TENANT_REF = "tenant-1";
const RESOURCE = "api_calls";

describe("UsageCounter (WP-11, F-07 — Float -> Decimal)", () => {
  it("starts at zero and increments by a whole amount", () => {
    const counter = UsageCounter.create(ID, TENANT_REF, RESOURCE, "e1", new Date());
    expect(counter.amount).toBe(0);

    counter.recordUsage(5, "api_calls", new Date(), "e2");
    expect(counter.amount).toBe(5);
    expect(counter.unit).toBe("api_calls");
  });

  it("incrementing by a fractional value one thousand times produces an EXACT total — the worst case F-07 names", () => {
    // A plain JS `number` accumulator drifts here: 1000 additions of 0.1 in IEEE-754 float does
    // NOT equal exactly 100 (classic binary-floating-point representation error). This is the
    // precise regression T11.4 asks to prove is fixed.
    const counter = UsageCounter.create(ID, TENANT_REF, RESOURCE, "e1", new Date());

    for (let i = 0; i < 1000; i += 1) {
      counter.recordUsage(0.1, "gb", new Date(), `e-${i}`);
    }

    expect(counter.amount).toBe(100);
    expect(counter.amountDecimalString).toBe("100.0000");
  });

  it("handles a mixed sequence of fractional increments exactly", () => {
    const counter = UsageCounter.create(ID, TENANT_REF, RESOURCE, "e1", new Date());
    const increments = [0.1, 0.2, 0.3, 1.1, 2.7, 0.05, 0.05];

    for (const [index, amount] of increments.entries()) {
      counter.recordUsage(amount, "gb", new Date(), `e-${index}`);
    }

    // 0.1+0.2+0.3+1.1+2.7+0.05+0.05 = 4.5 exactly.
    expect(counter.amount).toBe(4.5);
  });

  it("round-trips through reconstitute unchanged, given the exact decimal string a Prisma Decimal column would return", () => {
    const original = UsageCounter.create(ID, TENANT_REF, RESOURCE, "e1", new Date());
    original.recordUsage(19.9999, "gb", new Date(), "e2");
    expect(original.amountDecimalString).toBe("19.9999");

    // Simulates read-back: the mapper hands `reconstitute` whatever the (fake or real) Decimal
    // column returned — here, the exact decimal string this counter would have written.
    const reconstituted = UsageCounter.reconstitute(
      ID,
      TENANT_REF,
      RESOURCE,
      original.amountDecimalString,
      "gb",
      1,
    );

    expect(reconstituted.amount).toBe(19.9999);
    expect(reconstituted.amountDecimalString).toBe("19.9999");
  });
});
