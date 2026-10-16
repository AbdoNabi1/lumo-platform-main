import { UniqueEntityId } from "@platform/domain";
import { describe, expect, it } from "vitest";
import { Credit } from "./credit";

const ID = UniqueEntityId.from("credit-1");
const TENANT_REF = "tenant-1";

describe("Credit (WP-11, F-07 — Float -> Decimal)", () => {
  it("grants and consumes a whole amount", () => {
    const credit = Credit.grant(ID, TENANT_REF, 100, "promo", "e1", new Date());
    expect(credit.amount).toBe(100);
    expect(credit.status).toBe("granted");

    credit.consume(40, "e2", new Date());
    expect(credit.amount).toBe(60);
    expect(credit.status).toBe("granted");
  });

  it("consuming down to exactly zero transitions to consumed, with no float remainder", () => {
    // A plain `number` accumulator can leave a residue like 3.19744231e-16 instead of exactly 0
    // after repeated fractional subtraction — which would wrongly stay "granted" forever
    // (`isZero()`'s equivalent `=== 0` check on a float never true again). Decimal's exact
    // subtraction is what makes the status transition reliable.
    const credit = Credit.grant(ID, TENANT_REF, 10, "promo", "e1", new Date());

    for (let i = 0; i < 100; i += 1) {
      credit.consume(0.1, `e-${i}`, new Date());
    }

    expect(credit.amount).toBe(0);
    expect(credit.status).toBe("consumed");
  });

  it("refuses to consume more than the granted amount, using exact comparison", () => {
    const credit = Credit.grant(ID, TENANT_REF, 0.3, "promo", "e1", new Date());

    // 0.1 + 0.2 must compare exactly equal to the granted 0.3 — a float `>` comparison of
    // `0.1 + 0.2 > 0.3` is `true` in IEEE-754 (0.30000000000000004), which would wrongly reject
    // this as "more than granted".
    credit.consume(0.1, "e2", new Date());
    expect(() => credit.consume(0.2, "e3", new Date())).not.toThrow();
    expect(credit.amount).toBe(0);
    expect(credit.status).toBe("consumed");
  });

  it("round-trips through reconstitute unchanged, given the exact decimal string a Prisma Decimal column would return", () => {
    const original = Credit.grant(ID, TENANT_REF, 19.9999, "promo", "e1", new Date());

    const reconstituted = Credit.reconstitute(
      ID,
      TENANT_REF,
      original.amountDecimalString,
      "promo",
      "granted",
      0,
    );

    expect(reconstituted.amount).toBe(19.9999);
    expect(reconstituted.amountDecimalString).toBe("19.9999");
  });
});
