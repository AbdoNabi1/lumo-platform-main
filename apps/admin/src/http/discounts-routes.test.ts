import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import { wireAdmin, type WiredAdmin } from "../composition";
import type { DiscountDto } from "../interfaces/discounts/discount-dto";
import { discountsRoutes } from "./discounts-routes";

const TENANT = "tenant-local";
const clock: Clock = { now: () => new Date("2026-10-16T12:00:00.000Z") };
const staff: Principal = { id: "staff-1", kind: "staff", roles: ["admin"], tenantId: TENANT };

interface Response {
  readonly status: number;
  readonly body: unknown;
}

function build() {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `0000000${(n += 1)}`.slice(-8) };
  const admin: WiredAdmin = wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
  });
  const routes = discountsRoutes(admin);
  const call = (
    method: string,
    path: string,
    params: Record<string, string> = {},
    body?: unknown,
    query: Record<string, string> = {},
    tenantId: string = TENANT,
  ) => {
    const route = routes.find((r: RouteDefinition) => r.method === method && r.path === path);
    if (route === undefined) throw new Error(`no route ${method} ${path}`);
    const principal: Principal = { ...staff, tenantId };
    return route.handle({
      body,
      params,
      query,
      context: { tenantId, principal, requestId: "r" },
    } as never) as Promise<Response>;
  };
  return { admin, call };
}

const common = {
  minimumRequirement: { kind: "none" },
  customerEligibility: { kind: "all" },
  oncePerCustomer: false,
  combinesWith: { product: false, order: false, shipping: false },
  startsAt: "2026-01-01T00:00:00.000Z",
};

const sale10 = {
  ...common,
  type: "amount_off_order",
  method: "code",
  code: "sale10",
  value: { kind: "percentage", amount: 10 },
  minimumRequirement: { kind: "amount", amountMinor: 20_000 },
  usageLimit: 100,
  oncePerCustomer: true,
};

function body<T>(response: Response): T {
  if (response.status < 200 || response.status >= 300)
    throw new Error(`${response.status}: ${JSON.stringify(response.body)}`);
  return response.body as T;
}

describe("/discounts — Shopify-style facade (Phase 2)", () => {
  it("creates a code discount and reads it back in Shopify's shape", async () => {
    const { call } = build();
    const created = body<DiscountDto>(await call("POST", "/discounts", {}, sale10));
    expect(created).toMatchObject({
      type: "amount_off_order",
      method: "code",
      title: "SALE10",
      code: "SALE10",
      status: "active",
      value: { kind: "percentage", amount: 10 },
      minimumRequirement: { kind: "amount", amountMinor: 20_000 },
      usageLimit: 100,
      oncePerCustomer: true,
      usageCount: 0,
    });
    expect(
      body<DiscountDto>(await call("GET", "/discounts/:discountId", { discountId: created.id })),
    ).toEqual(created);
  });

  it("creates each of the four types", async () => {
    const { call } = build();
    const products = body<DiscountDto>(
      await call(
        "POST",
        "/discounts",
        {},
        {
          ...common,
          type: "amount_off_products",
          method: "automatic",
          title: "Shoes 20% off",
          value: { kind: "percentage", amount: 20 },
          appliesTo: { kind: "categories", refs: ["shoes"] },
        },
      ),
    );
    expect(products).toMatchObject({
      type: "amount_off_products",
      method: "automatic",
      code: null,
      appliesTo: { kind: "categories", refs: ["shoes"] },
    });

    const bxgy = body<DiscountDto>(
      await call(
        "POST",
        "/discounts",
        {},
        {
          ...common,
          type: "buy_x_get_y",
          method: "code",
          code: "SOCKS",
          buys: { kind: "quantity", value: 2, scope: "products", refs: ["shirt"] },
          gets: { quantity: 1, scope: "products", refs: ["sock"], effect: { kind: "free" } },
          maxUsesPerOrder: 1,
        },
      ),
    );
    expect(bxgy).toMatchObject({
      type: "buy_x_get_y",
      buys: { kind: "quantity", value: 2, scope: "products", refs: ["shirt"] },
      maxUsesPerOrder: 1,
    });

    const shipping = body<DiscountDto>(
      await call(
        "POST",
        "/discounts",
        {},
        {
          ...common,
          type: "free_shipping",
          method: "code",
          code: "SHIPFREE",
          countries: ["EG"],
          maxShippingRateMinor: 10_000,
        },
      ),
    );
    expect(shipping).toMatchObject({
      type: "free_shipping",
      countries: ["EG"],
      maxShippingRateMinor: 10_000,
    });
  });

  it("refuses a code already in use with a field error", async () => {
    const { call } = build();
    await call("POST", "/discounts", {}, sale10);
    const again = await call("POST", "/discounts", {}, { ...sale10, code: "SALE10" });
    expect(again.status).toBe(422);
    expect(JSON.stringify(again.body)).toContain("This code is already in use");
  });

  it("lists by tab and finds a discount by part of its code", async () => {
    const { call } = build();
    const active = body<DiscountDto>(await call("POST", "/discounts", {}, sale10));
    const later = body<DiscountDto>(
      await call(
        "POST",
        "/discounts",
        {},
        { ...sale10, code: "WINTER", startsAt: "2027-01-01T00:00:00.000Z" },
      ),
    );
    const ids = async (query: Record<string, string>) =>
      body<{ items: DiscountDto[] }>(
        await call("GET", "/discounts", {}, undefined, query),
      ).items.map((d) => d.id);
    expect(await ids({})).toEqual([later.id, active.id]);
    expect(await ids({ view: "active" })).toEqual([active.id]);
    expect(await ids({ view: "scheduled" })).toEqual([later.id]);
    expect(await ids({ q: "wint" })).toEqual([later.id]);
  });

  it("edits a discount, including its code and limits", async () => {
    const { call } = build();
    const created = body<DiscountDto>(await call("POST", "/discounts", {}, sale10));
    const edited = body<DiscountDto>(
      await call(
        "PUT",
        "/discounts/:discountId",
        { discountId: created.id },
        { ...sale10, code: "SALE15", value: { kind: "percentage", amount: 15 }, usageLimit: 5 },
      ),
    );
    expect(edited).toMatchObject({
      code: "SALE15",
      title: "SALE15",
      value: { kind: "percentage", amount: 15 },
      usageLimit: 5,
    });
  });

  it("never edits another tenant's discount", async () => {
    const { call } = build();
    const created = body<DiscountDto>(await call("POST", "/discounts", {}, sale10));
    const id = { discountId: created.id };
    const edit = { ...sale10, code: "HIJACK", value: { kind: "percentage", amount: 100 } };

    const fromOtherTenant = await call("PUT", "/discounts/:discountId", id, edit, {}, "tenant-b");
    expect(fromOtherTenant.status).toBe(404);
    // A tenantId in the body cannot redirect the write either: the form schema is strict.
    const smuggled = await call("PUT", "/discounts/:discountId", id, {
      ...edit,
      tenantId: "tenant-b",
    });
    expect(smuggled.status).toBe(422);

    const unchanged = body<DiscountDto>(await call("GET", "/discounts/:discountId", id));
    expect(unchanged).toMatchObject({
      code: "SALE10",
      value: { kind: "percentage", amount: 10 },
    });
  });

  it("refuses to change a discount's type or method", async () => {
    const { call } = build();
    const created = body<DiscountDto>(await call("POST", "/discounts", {}, sale10));
    const response = await call(
      "PUT",
      "/discounts/:discountId",
      { discountId: created.id },
      { ...common, type: "free_shipping", method: "code", code: "SALE10" },
    );
    expect(response.status).toBe(422);
  });

  it("deactivates (shown as expired), reactivates and deletes", async () => {
    const { call } = build();
    const created = body<DiscountDto>(await call("POST", "/discounts", {}, sale10));
    const id = { discountId: created.id };
    expect(
      body<DiscountDto>(await call("POST", "/discounts/:discountId/deactivate", id)).status,
    ).toBe("expired");
    expect(
      body<DiscountDto>(await call("POST", "/discounts/:discountId/activate", id)).status,
    ).toBe("active");
    expect((await call("DELETE", "/discounts/:discountId", id)).status).toBe(200);
    expect((await call("GET", "/discounts/:discountId", id)).status).toBe(404);
    expect(body<{ items: DiscountDto[] }>(await call("GET", "/discounts")).items).toEqual([]);
  });

  it("validates the input per type", async () => {
    const { call } = build();
    const missingValue = await call(
      "POST",
      "/discounts",
      {},
      { ...common, type: "amount_off_order", method: "code", code: "NOVALUE" },
    );
    expect(missingValue.status).toBe(422);
    const missingCode = await call(
      "POST",
      "/discounts",
      {},
      { ...common, type: "free_shipping", method: "code" },
    );
    expect(missingCode.status).toBe(422);
  });

  it("refuses use limits on an automatic discount", async () => {
    const { call } = build();
    const automatic = {
      ...common,
      type: "amount_off_order",
      method: "automatic",
      title: "Autumn",
      value: { kind: "percentage", amount: 5 },
    };
    const limited = await call("POST", "/discounts", {}, { ...automatic, usageLimit: 10 });
    expect(limited.status).toBe(422);
    expect(JSON.stringify(limited.body)).toContain("usageLimit");
    const oncePerCustomer = await call(
      "POST",
      "/discounts",
      {},
      { ...automatic, oncePerCustomer: true },
    );
    expect(oncePerCustomer.status).toBe(422);
    expect(JSON.stringify(oncePerCustomer.body)).toContain("oncePerCustomer");
    expect((await call("POST", "/discounts", {}, automatic)).status).toBe(201);
  });
});
