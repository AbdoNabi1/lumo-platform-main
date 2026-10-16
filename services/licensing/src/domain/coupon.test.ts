import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { Coupon, type CouponStatus, type CouponValue } from "./coupon";

/**
 * WP-14 T14.3 (first half): a coupon's lifecycle is a state machine the AGGREGATE enforces — issue,
 * redeem, expire, revoke — in the shape `Subscription`/`Invoice` already use (a `TRANSITIONS` table).
 * An illegal move is refused by the machine, never by a caller's `if`; every test below drives the
 * aggregate directly, with no use case in between.
 */
const NOW = new Date("2026-10-01T00:00:00.000Z");
const LATER = new Date("2026-12-01T00:00:00.000Z");
const AFTER_EXPIRY = new Date("2026-12-02T00:00:00.000Z");

const PERCENT_20: CouponValue = { kind: "percentage", basisPoints: 2000 };
const FIXED_500_EGP: CouponValue = { kind: "fixed", amountMinor: 500, currency: "EGP" };

function issue(value: CouponValue = PERCENT_20, merchantRef?: string): Coupon {
  return Coupon.issue(
    UniqueEntityId.from("coupon-1"),
    { code: "LAUNCH20", value, expiresAt: LATER, ...(merchantRef ? { merchantRef } : {}) },
    "e1",
    NOW,
  );
}

function inState(status: CouponStatus): Coupon {
  const coupon = issue();
  if (status === "redeemed") coupon.redeem("inv-1", "merchant-1", "e2", NOW);
  if (status === "expired") coupon.expire("e2", AFTER_EXPIRY);
  if (status === "revoked") coupon.revoke("issued in error", "e2", NOW);
  return coupon;
}

describe("Coupon lifecycle — one test per transition", () => {
  it("issue: a new coupon starts `issued` and raises licensing.coupon.issued", () => {
    const coupon = issue();
    expect(coupon.status).toBe("issued");
    expect(coupon.code).toBe("LAUNCH20");
    expect(
      coupon.domainEvents.map((e) => (e as unknown as { data: { action: string } }).data.action),
    ).toEqual(["issued"]);
  });

  it("issued -> redeemed: records the invoice it was redeemed on", () => {
    const coupon = issue();
    coupon.redeem("inv-1", "merchant-1", "e2", NOW);
    expect(coupon.status).toBe("redeemed");
    expect(coupon.redemption).toEqual({ invoiceRef: "inv-1", redeemedAt: NOW });
  });

  it("issued -> expired: only once its expiry has passed", () => {
    const coupon = issue();
    coupon.expire("e2", AFTER_EXPIRY);
    expect(coupon.status).toBe("expired");
  });

  it("issued -> revoked: records why", () => {
    const coupon = issue();
    coupon.revoke("issued in error", "e2", NOW);
    expect(coupon.status).toBe("revoked");
    expect(coupon.revokedReason).toBe("issued in error");
  });
});

describe("Coupon lifecycle — the machine refuses every illegal move", () => {
  const terminal: readonly CouponStatus[] = ["redeemed", "expired", "revoked"];
  const moves: Record<string, (coupon: Coupon) => void> = {
    redeem: (c) => c.redeem("inv-2", "merchant-1", "e9", NOW),
    expire: (c) => c.expire("e9", AFTER_EXPIRY),
    revoke: (c) => c.revoke("again", "e9", NOW),
  };

  for (const from of terminal) {
    for (const [name, move] of Object.entries(moves)) {
      it(`${from} -> ${name} is refused by the machine`, () => {
        const coupon = inState(from);
        expect(() => move(coupon)).toThrow(/cannot transition coupon/i);
        expect(coupon.status).toBe(from);
      });
    }
  }

  it("a redeemed coupon keeps its FIRST redemption after a refused second one", () => {
    const coupon = inState("redeemed");
    expect(() => coupon.redeem("inv-2", "merchant-1", "e9", NOW)).toThrow();
    expect(coupon.redemption?.invoiceRef).toBe("inv-1");
  });
});

describe("Coupon rules that are not a status move", () => {
  it("cannot be redeemed after its expiry even though no sweep has marked it expired", () => {
    const coupon = issue();
    expect(coupon.status).toBe("issued");
    expect(() => coupon.redeem("inv-1", "merchant-1", "e2", AFTER_EXPIRY)).toThrow(/expired/i);
    expect(coupon.status).toBe("issued");
  });

  it("cannot be marked expired before its expiry has passed", () => {
    expect(() => issue().expire("e2", NOW)).toThrow(/not.*expired|not reached/i);
  });

  it("a coupon addressed to one merchant is refused for another", () => {
    const coupon = issue(PERCENT_20, "merchant-1");
    expect(() => coupon.redeem("inv-9", "merchant-2", "e2", NOW)).toThrow(/merchant/i);
    expect(coupon.status).toBe("issued");
    coupon.redeem("inv-1", "merchant-1", "e3", NOW);
    expect(coupon.status).toBe("redeemed");
  });

  it("a bearer coupon (no merchant) redeems for any merchant", () => {
    const coupon = issue();
    coupon.redeem("inv-1", "merchant-77", "e2", NOW);
    expect(coupon.status).toBe("redeemed");
  });
});

describe("Coupon issuance validates at the door", () => {
  const attempt = (
    over: Partial<{ code: string; value: CouponValue; expiresAt: Date }>,
  ): (() => Coupon) => {
    return () =>
      Coupon.issue(
        UniqueEntityId.from("c"),
        { code: "LAUNCH20", value: PERCENT_20, expiresAt: LATER, ...over },
        "e1",
        NOW,
      );
  };

  it("normalises the code to upper case and refuses a malformed one", () => {
    expect(attempt({ code: "launch20" })().code).toBe("LAUNCH20");
    expect(attempt({ code: "no spaces" })).toThrow(/code/i);
    expect(attempt({ code: "ab" })).toThrow(/code/i);
  });

  it("refuses a percentage outside 1..10000 basis points or a non-integer one", () => {
    expect(attempt({ value: { kind: "percentage", basisPoints: 0 } })).toThrow(/basis/i);
    expect(attempt({ value: { kind: "percentage", basisPoints: 10001 } })).toThrow(/basis/i);
    expect(attempt({ value: { kind: "percentage", basisPoints: 12.5 } })).toThrow(/basis/i);
    expect(attempt({ value: { kind: "percentage", basisPoints: 10000 } })().status).toBe("issued");
  });

  it("refuses a fixed amount that is zero, negative, fractional, or has a malformed currency", () => {
    expect(attempt({ value: { kind: "fixed", amountMinor: 0, currency: "EGP" } })).toThrow(
      /minor/i,
    );
    expect(attempt({ value: { kind: "fixed", amountMinor: -5, currency: "EGP" } })).toThrow(
      /minor/i,
    );
    expect(attempt({ value: { kind: "fixed", amountMinor: 5.5, currency: "EGP" } })).toThrow(
      /minor/i,
    );
    expect(attempt({ value: { kind: "fixed", amountMinor: 500, currency: "egp" } })).toThrow(
      /currency/i,
    );
  });

  it("refuses an expiry that is not in the future", () => {
    expect(attempt({ expiresAt: NOW })).toThrow(/expir/i);
    expect(attempt({ expiresAt: new Date("2026-01-01T00:00:00.000Z") })).toThrow(/expir/i);
  });
});

describe("Coupon.discountFor — what a coupon is worth against a subtotal", () => {
  const egp = (minor: number) => {
    const money = Money.create(minor, "EGP");
    if (!money.ok) throw new Error("bad money");
    return money.value;
  };

  it("a percentage rounds DOWN to whole minor units", () => {
    // 20% of 2999 = 599.8 -> 599
    expect(issue(PERCENT_20).discountFor(egp(2999)).amountMinor).toBe(599);
  });

  it("100% is worth exactly the subtotal", () => {
    const full = issue({ kind: "percentage", basisPoints: 10000 });
    expect(full.discountFor(egp(2999)).amountMinor).toBe(2999);
  });

  it("does not overflow on a large subtotal (exact integer arithmetic)", () => {
    const big = Number.MAX_SAFE_INTEGER - 1;
    const full = issue({ kind: "percentage", basisPoints: 10000 });
    expect(full.discountFor(egp(big)).amountMinor).toBe(big);
  });

  it("a fixed amount is worth its face value in the matching currency", () => {
    expect(issue(FIXED_500_EGP).discountFor(egp(2900)).amountMinor).toBe(500);
  });

  it("a fixed amount in a DIFFERENT currency is refused, never converted", () => {
    const usd = Money.create(2900, "USD");
    if (!usd.ok) throw new Error("bad money");
    expect(() => issue(FIXED_500_EGP).discountFor(usd.value)).toThrow(/currency/i);
  });

  it("a fixed amount worth more than the subtotal is refused, never floored to zero", () => {
    expect(() =>
      issue({ kind: "fixed", amountMinor: 5000, currency: "EGP" }).discountFor(egp(2900)),
    ).toThrow(/more than/i);
  });

  it("a discount that rounds to nothing is refused rather than consuming the coupon", () => {
    // 1% of 50 = 0.5 -> 0
    expect(() => issue({ kind: "percentage", basisPoints: 100 }).discountFor(egp(50))).toThrow(
      /nothing|zero/i,
    );
  });
});
