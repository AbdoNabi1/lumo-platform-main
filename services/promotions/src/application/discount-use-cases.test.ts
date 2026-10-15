import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { Paginated } from "@platform/types";
import { wirePromotions } from "../composition";
import type { Promotion } from "../domain/promotion";

const TENANT = "tenant-1";
const clock: Clock = { now: () => new Date("2026-10-16T12:00:00.000Z") };

function build() {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `0000000${(n += 1)}`.slice(-8) };
  return wirePromotions({ serializer: new InMemoryEventSerializer(), idGenerator, clock })
    .promotions;
}

const base = {
  tenantId: TENANT,
  ruleType: "automatic" as const,
  scope: "cart" as const,
  targetRefs: [],
  rewardType: "percentage" as const,
  rewardValue: 10,
  stackable: false,
  priority: 0,
  startsAt: new Date("2026-01-01T00:00:00.000Z"),
};

async function create(controller: ReturnType<typeof build>, overrides: Record<string, unknown>) {
  const response = await controller.create({ ...base, name: "x", ...overrides } as never);
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  const { promotionId } = response.body as { promotionId: string };
  await controller.advance({ tenantId: TENANT, promotionId, toStatus: "active" });
  return promotionId;
}

describe("promotions — discount use cases (Phase 2)", () => {
  it("lists only automatic, active promotions for checkout", async () => {
    const c = build();
    const auto = await create(c, { name: "Auto", method: "automatic" });
    await create(c, { name: "CODE10", method: "code" });
    const response = await c.listActiveAutomatic({ tenantId: TENANT });
    const { items } = response.body as { items: readonly Promotion[] };
    expect(items.map((p) => p.id.toString())).toEqual([auto]);
  });

  it("updates a discount and keeps its new settings", async () => {
    const c = build();
    const id = await create(c, { name: "Auto", method: "automatic" });
    const response = await c.update({
      ...base,
      promotionId: id,
      name: "Autumn",
      rewardValue: 20,
      combinesWith: { product: true, order: false, shipping: true },
    });
    expect(response.status).toBe(200);
    const promotion = (await c.get({ tenantId: TENANT, promotionId: id })).body as Promotion;
    expect(promotion.name).toBe("Autumn");
    expect(promotion.rule.reward.value).toBe(20);
    expect(promotion.combinesWith).toEqual({ product: true, order: false, shipping: true });
  });

  it("refuses an update that changes the type", async () => {
    const c = build();
    const id = await create(c, { method: "automatic" });
    const response = await c.update({
      ...base,
      promotionId: id,
      name: "x",
      rewardType: "free_shipping",
    });
    expect(response.status).toBe(409);
  });

  it("filters the admin list by view and search, newest first, never archived", async () => {
    const c = build();
    const a = await create(c, { name: "Alpha" });
    const b = await create(c, { name: "Beta", startsAt: new Date("2027-01-01T00:00:00.000Z") });
    const d = await create(c, { name: "Delta" });
    await c.advance({ tenantId: TENANT, promotionId: d, toStatus: "archived" });

    const list = async (input: Record<string, unknown>) =>
      (
        (await c.listForAdmin({ tenantId: TENANT, view: "all", ...input } as never))
          .body as Paginated<Promotion>
      ).items.map((p) => p.id.toString());
    expect(await list({})).toEqual([b, a]);
    expect(await list({ view: "active" })).toEqual([a]);
    expect(await list({ view: "scheduled" })).toEqual([b]);
    expect(await list({ search: "alp" })).toEqual([a]);
    expect(await list({ search: "zzz", alsoIds: [b] })).toEqual([b]);
  });

  it("keeps the minimum purchase and the customer list it was created with", async () => {
    const c = build();
    const id = await create(c, { minimumSubtotalAmountMinor: 20_000, customerRefs: ["c-1"] });
    const promotion = (await c.get({ tenantId: TENANT, promotionId: id })).body as Promotion;
    expect(promotion.rule.condition.minimumSubtotalAmountMinor).toBe(20_000);
    expect(promotion.eligibility.customerRefs).toEqual(["c-1"]);
  });
});
