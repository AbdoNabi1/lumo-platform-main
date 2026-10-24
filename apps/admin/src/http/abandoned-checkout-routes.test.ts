import { describe, expect, it } from "vitest";
import type { Principal } from "@platform/contracts";
import type {
  AbandonedCheckoutDetailDto,
  AbandonedCheckoutListItemDto,
  RecoveryLinkDto,
} from "./abandoned-checkout-dto";
import {
  abandonCheckout,
  HOUR_MS,
  recoveryWorld,
  seedRecoveryProduct,
  unwrap,
  type RecoveryWorld,
} from "./testing/abandoned-harness";
import { HARNESS_TENANT, operatorStaff, viewerStaff } from "./testing/orders-harness";

interface Page {
  readonly items: readonly AbandonedCheckoutListItemDto[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
}

const nobody: Principal = { id: "staff-none", kind: "staff", roles: [], tenantId: HARNESS_TENANT };

async function setup() {
  const world = recoveryWorld();
  const product = await seedRecoveryProduct(world, "TEE", 25000);
  const { checkoutSessionId } = await abandonCheckout(world, {
    sessionRef: "guest-secret-1",
    lines: [{ product, quantity: 2 }],
    email: "Sara@Example.com",
  });
  return { world, product, checkoutSessionId };
}

const list = (
  world: RecoveryWorld,
  query: Record<string, string> = {},
  principal: Principal = viewerStaff,
) => world.staffCall("GET", "/abandoned-checkouts", { query }, principal);
const detail = (world: RecoveryWorld, id: string, principal: Principal = viewerStaff) =>
  world.staffCall(
    "GET",
    "/abandoned-checkouts/:checkoutSessionId",
    { params: { checkoutSessionId: id } },
    principal,
  );
const issue = (world: RecoveryWorld, id: string, principal: Principal = operatorStaff) =>
  world.staffCall(
    "POST",
    "/abandoned-checkouts/:checkoutSessionId/recovery-link",
    { params: { checkoutSessionId: id } },
    principal,
  );

describe("GET /abandoned-checkouts (order operations Part 3)", () => {
  it("lists a checkout once idle an hour, to a viewer, with Shopify's columns and no sessionRef", async () => {
    const { world, checkoutSessionId } = await setup();
    expect(unwrap<Page>(await list(world), "list").items).toEqual([]);

    world.clock.advance(2 * HOUR_MS);
    const page = unwrap<Page>(await list(world), "list");
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: checkoutSessionId,
      reference: `#${checkoutSessionId.replace(/-/g, "").slice(-8).toUpperCase()}`,
      customerName: "Mona Ali",
      email: "sara@example.com",
      phone: "01001234567",
      region: "EG-C",
      country: "EG",
      itemCount: 2,
      totalMinor: 50000,
      currency: "EGP",
      recoveryStatus: "not_recovered",
      recoveredOrder: null,
      lastLinkIssuedAt: null,
    });
    expect(JSON.stringify(page)).not.toContain("guest-secret-1");
    expect(JSON.stringify(page)).not.toContain("sessionRef");
  });

  it("searches by email, name or phone and filters by recovery status", async () => {
    const { world } = await setup();
    world.clock.advance(2 * HOUR_MS);
    const count = async (query: Record<string, string>) =>
      unwrap<Page>(await list(world, query), "list").items.length;
    expect(await count({ q: "SARA" })).toBe(1);
    expect(await count({ q: "mona" })).toBe(1);
    expect(await count({ q: "0100123" })).toBe(1);
    expect(await count({ q: "nobody" })).toBe(0);
    expect(await count({ recovery: "not_recovered" })).toBe(1);
    expect(await count({ recovery: "recovered" })).toBe(0);
  });

  it("is orders:read; a staff member without it is refused", async () => {
    const { world } = await setup();
    const route = world.routes.find((r) => r.method === "GET" && r.path === "/abandoned-checkouts");
    expect(route?.permission).toBe("orders:read");
    expect(route?.schema.querystring?.safeParse({ first: "51" }).success).toBe(false);
    expect(route?.schema.querystring?.safeParse({ recovery: "maybe" }).success).toBe(false);
    expect((await list(world, {}, nobody)).status).toBe(403);
  });
});

describe("GET /abandoned-checkouts/:checkoutSessionId", () => {
  it("answers lines (with images), the address and the link history", async () => {
    const { world, checkoutSessionId } = await setup();
    world.clock.advance(2 * HOUR_MS);
    const dto = unwrap<AbandonedCheckoutDetailDto>(
      await detail(world, checkoutSessionId),
      "detail",
    );
    expect(dto.items).toHaveLength(1);
    expect(dto.items[0]).toMatchObject({ quantity: 2, unitPriceMinor: 25000, sku: "TEE-STD" });
    expect(dto.items[0]).toHaveProperty("imageUrl");
    expect(dto.shippingAddress?.city).toBe("Cairo");
    expect(dto.links).toEqual([]);
    expect(JSON.stringify(dto)).not.toContain("guest-secret-1");
  });

  it("is 404 for a fresh checkout, an unknown id and a non-UUID id (Review Focus 5)", async () => {
    const { world, checkoutSessionId } = await setup();
    expect((await detail(world, checkoutSessionId)).status).toBe(404);
    world.clock.advance(2 * HOUR_MS);
    expect((await detail(world, "00000000-0000-7000-8000-0000000fffff")).status).toBe(404);
    expect((await detail(world, "abc")).status).toBe(404);
  });
});

describe("POST /abandoned-checkouts/:checkoutSessionId/recovery-link", () => {
  it("an operator gets a /c/<token> path valid for 7 days; the list and detail show it was shared", async () => {
    const { world, checkoutSessionId } = await setup();
    world.clock.advance(2 * HOUR_MS);
    const reply = await issue(world, checkoutSessionId);
    expect(reply.status).toBe(201);
    const link = reply.body as RecoveryLinkDto;
    expect(link.path).toMatch(/^\/c\/[A-Za-z0-9_-]{43}$/);
    expect(link.url).toBeNull(); // the in-memory shop has no verified primary domain
    expect(link.expiresAt).toBe(
      new Date(world.clock.now().getTime() + 7 * 24 * HOUR_MS).toISOString(),
    );
    expect(typeof link.shopName).toBe("string");
    expect(Object.keys(link).sort()).toEqual(["expiresAt", "path", "shopName", "url"]);

    const dto = unwrap<AbandonedCheckoutDetailDto>(
      await detail(world, checkoutSessionId),
      "detail",
    );
    expect(dto.links).toEqual([
      {
        issuedAt: world.clock.now().toISOString(),
        expiresAt: link.expiresAt,
        claimCount: 0,
        lastClaimedAt: null,
      },
    ]);
    // The token is shown once, in the 201 above: neither it nor its hash is ever read back.
    expect(JSON.stringify(dto)).not.toContain(link.path.slice(3));
    expect(unwrap<Page>(await list(world), "list").items[0]?.lastLinkIssuedAt).toBe(
      world.clock.now().toISOString(),
    );
  });

  it("each copy is a new link", async () => {
    const { world, checkoutSessionId } = await setup();
    world.clock.advance(2 * HOUR_MS);
    const first = (await issue(world, checkoutSessionId)).body as RecoveryLinkDto;
    const second = (await issue(world, checkoutSessionId)).body as RecoveryLinkDto;
    expect(second.path).not.toBe(first.path);
  });

  it("is orders:recover_checkout and idempotent; a viewer is refused; a fresh checkout is 404", async () => {
    const { world, checkoutSessionId } = await setup();
    const route = world.routes.find(
      (r) =>
        r.method === "POST" && r.path === "/abandoned-checkouts/:checkoutSessionId/recovery-link",
    );
    expect(route?.permission).toBe("orders:recover_checkout");
    expect(route?.idempotent).toBe(true);
    expect((await issue(world, checkoutSessionId)).status).toBe(404);
    world.clock.advance(2 * HOUR_MS);
    expect((await issue(world, checkoutSessionId, viewerStaff)).status).toBe(403);
  });
});
