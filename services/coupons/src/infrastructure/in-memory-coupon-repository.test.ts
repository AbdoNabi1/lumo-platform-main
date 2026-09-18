import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { Coupon } from "../domain/coupon";
import { CouponCode } from "../domain/value-objects/coupon-code";
import { CouponsEventTranslator } from "./coupons-event-translator";
import { InMemoryCouponRepository } from "./in-memory-coupon-repository";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("test setup: invalid VO");
  return r.value;
}

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

function wire() {
  const nextId = monotonicIds();
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new CouponsEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-07-05T00:00:00.000Z") },
    producer: "coupons",
  });
  const context = rootEventContext({ generate: nextId });
  const repository = new InMemoryCouponRepository({ outbox, context });
  return { repository, nextId };
}

describe("InMemoryCouponRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's coupon by id, code, redemption, or list, through a single repository instance", async () => {
    const { repository, nextId } = wire();
    const coupon = Coupon.create(
      UniqueEntityId.from(nextId()),
      must(CouponCode.create("SAVE10")),
      "promo-1",
      false,
    );
    await repository.save(coupon, "tenant-a");

    expect(await repository.findById(coupon.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repository.findById(coupon.id.toString(), "tenant-b")).toBeNull();

    expect(await repository.findByCode("SAVE10", "tenant-a")).not.toBeNull();
    expect(await repository.findByCode("SAVE10", "tenant-b")).toBeNull();

    expect(await repository.hasRedemption(coupon.id.toString(), "key-1", "tenant-a")).toBe(false);
    expect(await repository.hasRedemption(coupon.id.toString(), "key-1", "tenant-b")).toBe(false);

    const pageA = await repository.list({}, "tenant-a");
    const pageB = await repository.list({}, "tenant-b");
    expect(pageA.items.map((c) => c.id.toString())).toContain(coupon.id.toString());
    expect(pageB.items.map((c) => c.id.toString())).not.toContain(coupon.id.toString());
  });
});

describe("InMemoryCouponRepository write-time tenant (ADR-0014 amendment 2026-09-18)", () => {
  it("carries each call's tenantId into the outbox envelope, not the singleton context's", async () => {
    await assertWriteTimeTenant("coupons", async (outbox, tenantId) => {
      const nextId = monotonicIds();
      const repository = new InMemoryCouponRepository({
        outbox,
        context: rootEventContext({ generate: nextId }),
      });
      const agg = Coupon.create(
        UniqueEntityId.from(nextId()),
        must(CouponCode.create("SAVE10")),
        "promo-1",
        false,
      );
      agg.disable(nextId(), new Date(0));
      await repository.save(agg, tenantId);
    });
  });
});
