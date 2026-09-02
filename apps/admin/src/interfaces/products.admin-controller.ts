import type { BrandController, CategoryController, ProductController } from "@platform/catalog";
import type { Principal } from "@platform/contracts";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface ProductsAdminControllerDeps {
  readonly products: ProductController;
  readonly categories: CategoryController;
  readonly brands: BrandController;
  readonly guard: AdminGuard;
}

/**
 * Wires the frozen **Products** admin screen to the Catalog context (Sprint 1.1 base, extended
 * Commerce Sprint 1 + Sprint 7.0). Pure delegation — no business behaviour is added or changed;
 * input/output types come straight from the Catalog controllers. Every action authorizes the
 * acting principal first (RBAC seam, ADR-0007; permissive until real RBAC lands). Collection has
 * **no** admin surface here — Sprint 7.0 §13 explicitly deferred it ("No UI" scope).
 */
export class ProductsAdminController {
  private readonly products: ProductController;
  private readonly categories: CategoryController;
  private readonly brands: BrandController;
  private readonly guard: AdminGuard;

  constructor(deps: ProductsAdminControllerDeps) {
    this.products = deps.products;
    this.categories = deps.categories;
    this.brands = deps.brands;
    this.guard = deps.guard;
  }

  async createProduct(
    principal: Principal,
    input: Parameters<ProductController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "products:create");
    if (denied) return denied;
    return this.products.create(input);
  }

  async updateProduct(
    principal: Principal,
    input: Parameters<ProductController["update"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "products:update");
    if (denied) return denied;
    return this.products.update(input);
  }

  async publishProduct(
    principal: Principal,
    input: Parameters<ProductController["publish"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "products:publish");
    if (denied) return denied;
    return this.products.publish(input);
  }

  async schedulePublishProduct(
    principal: Principal,
    input: Parameters<ProductController["schedulePublish"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "products:publish");
    if (denied) return denied;
    return this.products.schedulePublish(input);
  }

  async unpublishProduct(
    principal: Principal,
    input: Parameters<ProductController["unpublish"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "products:publish");
    if (denied) return denied;
    return this.products.unpublish(input);
  }

  async archiveProduct(
    principal: Principal,
    input: Parameters<ProductController["archive"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "products:update");
    if (denied) return denied;
    return this.products.archive(input);
  }

  async deleteProduct(
    principal: Principal,
    input: Parameters<ProductController["delete"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "products:delete");
    if (denied) return denied;
    return this.products.delete(input);
  }

  async getProduct(
    principal: Principal,
    input: Parameters<ProductController["get"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "products:read");
    if (denied) return denied;
    return this.products.get(input);
  }

  async listProducts(
    principal: Principal,
    input: Parameters<ProductController["list"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "products:read");
    if (denied) return denied;
    return this.products.list(input);
  }

  async addVariant(
    principal: Principal,
    input: Parameters<ProductController["addVariant"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "products:update");
    if (denied) return denied;
    return this.products.addVariant(input);
  }

  async removeVariant(
    principal: Principal,
    input: Parameters<ProductController["removeVariant"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "products:update");
    if (denied) return denied;
    return this.products.removeVariant(input);
  }

  async updateVariant(
    principal: Principal,
    input: Parameters<ProductController["updateVariant"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "products:update");
    if (denied) return denied;
    return this.products.updateVariant(input);
  }

  async setProductOptions(
    principal: Principal,
    input: Parameters<ProductController["setOptions"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "products:update");
    if (denied) return denied;
    return this.products.setOptions(input);
  }

  async setProductSeo(
    principal: Principal,
    input: Parameters<ProductController["setSeo"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "products:update");
    if (denied) return denied;
    return this.products.setSeo(input);
  }

  async setProductBrand(
    principal: Principal,
    input: Parameters<ProductController["setBrand"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "products:update");
    if (denied) return denied;
    return this.products.setBrand(input);
  }

  async assignCategories(
    principal: Principal,
    input: Parameters<ProductController["assignCategories"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "products:update");
    if (denied) return denied;
    return this.products.assignCategories(input);
  }

  async attachMedia(
    principal: Principal,
    input: Parameters<ProductController["attachMedia"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "products:update");
    if (denied) return denied;
    return this.products.attachMedia(input);
  }

  async detachMedia(
    principal: Principal,
    input: Parameters<ProductController["detachMedia"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "products:update");
    if (denied) return denied;
    return this.products.detachMedia(input);
  }

  async reorderMedia(
    principal: Principal,
    input: Parameters<ProductController["reorderMedia"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "products:update");
    if (denied) return denied;
    return this.products.reorderMedia(input);
  }

  async createCategory(
    principal: Principal,
    input: Parameters<CategoryController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "categories:create");
    if (denied) return denied;
    return this.categories.create(input);
  }

  async moveCategory(
    principal: Principal,
    input: Parameters<CategoryController["move"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "categories:update");
    if (denied) return denied;
    return this.categories.move(input);
  }

  async deleteCategory(
    principal: Principal,
    input: Parameters<CategoryController["delete"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "categories:delete");
    if (denied) return denied;
    return this.categories.delete(input);
  }

  async listCategories(
    principal: Principal,
    input: Parameters<CategoryController["list"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "categories:read");
    if (denied) return denied;
    return this.categories.list(input);
  }

  async createBrand(
    principal: Principal,
    input: Parameters<BrandController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "brands:create");
    if (denied) return denied;
    return this.brands.create(input);
  }

  async updateBrand(
    principal: Principal,
    input: Parameters<BrandController["update"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "brands:update");
    if (denied) return denied;
    return this.brands.update(input);
  }

  async deleteBrand(
    principal: Principal,
    input: Parameters<BrandController["delete"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "brands:delete");
    if (denied) return denied;
    return this.brands.delete(input);
  }

  async listBrands(
    principal: Principal,
    input: Parameters<BrandController["list"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "brands:read");
    if (denied) return denied;
    return this.brands.list(input);
  }
}
