import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionController, ProductController } from "@platform/catalog";
import type { Principal } from "@platform/contracts";
import type { AdminGuard } from "./admin-guard";
import { CollectionsAdminController } from "./collections.admin-controller";

const principal: Principal = { id: "staff-1", kind: "staff", roles: [], tenantId: "t-1" };
const result = { status: 200, body: { ok: true } };
const input = {
  tenantId: "t-1",
  collectionId: "collection-1",
  name: "Summer",
  slug: "summer",
  ids: [],
  productId: "product-1",
  productIds: [],
};
const methods = [
  ["list", "collections:read"],
  ["getByIds", "collections:read"],
  ["listMemberProducts", "collections:read"],
  ["create", "collections:create"],
  ["rename", "collections:update"],
  ["addProduct", "collections:update"],
  ["removeProduct", "collections:update"],
  ["reorderProducts", "collections:update"],
  ["publish", "collections:publish"],
  ["unpublish", "collections:publish"],
  ["delete", "collections:delete"],
] as const;
beforeEach(() => expect.hasAssertions());
describe("CollectionsAdminController", () => {
  it("returns guard denial without calling the catalog", async () => {
    const denied = { status: 403, body: { code: "FORBIDDEN" } };
    const create = vi.fn();
    const target = new CollectionsAdminController({
      guard: { ensure: vi.fn().mockResolvedValue(denied) } as unknown as AdminGuard,
      collections: { create } as unknown as CollectionController,
      products: {} as ProductController,
    });
    expect(await target.create(principal, input)).toBe(denied);
    expect(create).not.toHaveBeenCalled();
  });
  it("passes the exact rename input and response through", async () => {
    const rename = vi.fn().mockResolvedValue(result);
    const target = new CollectionsAdminController({
      guard: { ensure: vi.fn().mockResolvedValue(null) } as unknown as AdminGuard,
      collections: { rename } as unknown as CollectionController,
      products: {} as ProductController,
    });
    const value = { collectionId: "collection-1", name: "Summer", tenantId: "t-1" };
    expect(await target.rename(principal, value)).toBe(result);
    expect(rename).toHaveBeenCalledOnce();
    expect(rename).toHaveBeenCalledWith(value);
  });
  it("guards listMembers and passes through collection and product errors", async () => {
    const ensure = vi.fn().mockResolvedValue(null);
    const error = { status: 503, body: { code: "UNAVAILABLE" } };
    const getByIds = vi
      .fn()
      .mockResolvedValueOnce(error)
      .mockResolvedValueOnce({ status: 200, body: [{ productIds: ["p-1"] }] });
    const products = { getByIds: vi.fn().mockResolvedValue(error) };
    const target = new CollectionsAdminController({
      guard: { ensure } as unknown as AdminGuard,
      collections: { getByIds } as unknown as CollectionController,
      products: products as unknown as ProductController,
    });
    const args = { collectionId: "c-1", tenantId: "t-1" };
    expect(await target.listMembers(principal, args)).toBe(error);
    expect(await target.listMembers(principal, args)).toBe(error);
    expect(ensure).toHaveBeenCalledWith(principal, "collections:read");
    expect(products.getByIds).toHaveBeenCalledWith({ ids: ["p-1"], tenantId: "t-1" });
  });
  it.each(methods)("%s asks for %s", async (method, permission) => {
    const ensure = vi.fn().mockResolvedValue(null);
    const collections = Object.fromEntries(
      methods.map(([name]) => [name, vi.fn().mockResolvedValue(result)]),
    ) as unknown as CollectionController;
    const target = new CollectionsAdminController({
      guard: { ensure } as unknown as AdminGuard,
      collections,
      products: {} as ProductController,
    });
    await target[method](principal, input);
    expect(ensure).toHaveBeenCalledWith(principal, permission);
  });
});
