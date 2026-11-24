import type {
  Collection,
  CollectionController,
  Product,
  ProductController,
} from "@platform/catalog";
import type { Principal } from "@platform/contracts";
import { NotFoundError, toErrorEnvelope } from "@platform/utils";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface CollectionsAdminControllerDeps {
  readonly collections: CollectionController;
  readonly products: ProductController;
  readonly guard: AdminGuard;
}
export interface AdminCollectionMemberDto {
  readonly productId: string;
  readonly position: number;
  readonly name: string | null;
  readonly status: "draft" | "scheduled" | "published" | "unlisted" | "archived" | null;
  readonly missing: boolean;
}
export class CollectionsAdminController {
  constructor(private readonly deps: CollectionsAdminControllerDeps) {}
  async list(
    principal: Principal,
    input: Parameters<CollectionController["list"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "collections:read");
    if (denied) return denied;
    return this.deps.collections.list(input);
  }
  async getByIds(
    principal: Principal,
    input: Parameters<CollectionController["getByIds"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "collections:read");
    if (denied) return denied;
    return this.deps.collections.getByIds(input);
  }
  async listMemberProducts(
    principal: Principal,
    input: Parameters<CollectionController["listMemberProducts"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "collections:read");
    if (denied) return denied;
    return this.deps.collections.listMemberProducts(input);
  }
  async create(
    principal: Principal,
    input: Parameters<CollectionController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "collections:create");
    if (denied) return denied;
    return this.deps.collections.create(input);
  }
  async rename(
    principal: Principal,
    input: Parameters<CollectionController["rename"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "collections:update");
    if (denied) return denied;
    return this.deps.collections.rename(input);
  }
  async addProduct(
    principal: Principal,
    input: Parameters<CollectionController["addProduct"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "collections:update");
    if (denied) return denied;
    return this.deps.collections.addProduct(input);
  }
  async removeProduct(
    principal: Principal,
    input: Parameters<CollectionController["removeProduct"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "collections:update");
    if (denied) return denied;
    return this.deps.collections.removeProduct(input);
  }
  async reorderProducts(
    principal: Principal,
    input: Parameters<CollectionController["reorderProducts"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "collections:update");
    if (denied) return denied;
    return this.deps.collections.reorderProducts(input);
  }
  async publish(
    principal: Principal,
    input: Parameters<CollectionController["publish"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "collections:publish");
    if (denied) return denied;
    return this.deps.collections.publish(input);
  }
  async unpublish(
    principal: Principal,
    input: Parameters<CollectionController["unpublish"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "collections:publish");
    if (denied) return denied;
    return this.deps.collections.unpublish(input);
  }
  async delete(
    principal: Principal,
    input: Parameters<CollectionController["delete"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "collections:delete");
    if (denied) return denied;
    return this.deps.collections.delete(input);
  }
  async listMembers(
    principal: Principal,
    input: {
      collectionId: string;
      tenantId: string;
      first?: number | undefined;
      after?: string | undefined;
    },
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "collections:read");
    if (denied) return denied;
    const response = await this.deps.collections.getByIds({
      ids: [input.collectionId],
      tenantId: input.tenantId,
    });
    if (response.status !== 200) return response;
    const collection = (response.body as readonly Collection[])[0];
    if (!collection)
      return { status: 404, body: toErrorEnvelope(new NotFoundError("Collection not found")) };
    const parsed = input.after === undefined ? -1 : Number(input.after);
    const start = Number.isSafeInteger(parsed) && parsed >= -1 ? parsed + 1 : 0;
    const limit = Math.min(100, Math.max(1, input.first ?? 50));
    const ids = collection.productIds.slice(start, start + limit);
    const products = await this.deps.products.getByIds({ ids, tenantId: input.tenantId });
    if (products.status !== 200) return products;
    const byId = new Map(
      (products.body as readonly Product[]).map((product) => [product.id.value, product]),
    );
    const items: AdminCollectionMemberDto[] = ids.map((productId, index) => {
      const product = byId.get(productId);
      return {
        productId,
        position: start + index,
        name: product?.name ?? null,
        status: product?.status.value ?? null,
        missing: !product,
      };
    });
    return {
      status: 200,
      body: {
        items,
        pageInfo: {
          hasNextPage: start + ids.length < collection.productIds.length,
          endCursor: ids.length ? String(start + ids.length - 1) : null,
        },
      },
    };
  }
}
