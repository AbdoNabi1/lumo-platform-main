import type { AddVariant, AddVariantInput } from "../application/add-variant.use-case";
import type { ArchiveProduct, ArchiveProductInput } from "../application/archive-product.use-case";
import type {
  AssignCategories,
  AssignCategoriesInput,
} from "../application/assign-categories.use-case";
import type { AttachMedia, AttachMediaInput } from "../application/attach-media.use-case";
import type { CreateProduct, CreateProductInput } from "../application/create-product.use-case";
import type { DeleteProduct, DeleteProductInput } from "../application/delete-product.use-case";
import type { DetachMedia, DetachMediaInput } from "../application/detach-media.use-case";
import type {
  GetProductBySlug,
  GetProductBySlugInput,
} from "../application/get-product-by-slug.use-case";
import type { GetProduct, GetProductInput } from "../application/get-product.use-case";
import type { ListProducts, ListProductsInput } from "../application/list-products.use-case";
import type { PublishProduct, PublishProductInput } from "../application/publish-product.use-case";
import type { RemoveVariant, RemoveVariantInput } from "../application/remove-variant.use-case";
import type { ReorderMedia, ReorderMediaInput } from "../application/reorder-media.use-case";
import type {
  SchedulePublishProduct,
  SchedulePublishProductInput,
} from "../application/schedule-publish-product.use-case";
import type {
  SetProductBrand,
  SetProductBrandInput,
} from "../application/set-product-brand.use-case";
import type {
  SetProductOptions,
  SetProductOptionsInput,
} from "../application/set-product-options.use-case";
import type { SetProductSeo, SetProductSeoInput } from "../application/set-product-seo.use-case";
import type {
  UnpublishProduct,
  UnpublishProductInput,
} from "../application/unpublish-product.use-case";
import type { UpdateProduct, UpdateProductInput } from "../application/update-product.use-case";
import type { UpdateVariant, UpdateVariantInput } from "../application/update-variant.use-case";
import { type ControllerResponse, present } from "./presenter";

export interface ProductControllerDeps {
  readonly createProduct: CreateProduct;
  readonly publishProduct: PublishProduct;
  readonly updateProduct: UpdateProduct;
  readonly getProduct: GetProduct;
  readonly getProductBySlug: GetProductBySlug;
  readonly listProducts: ListProducts;
  readonly schedulePublishProduct: SchedulePublishProduct;
  readonly unpublishProduct: UnpublishProduct;
  readonly archiveProduct: ArchiveProduct;
  readonly deleteProduct: DeleteProduct;
  readonly addVariant: AddVariant;
  readonly removeVariant: RemoveVariant;
  readonly updateVariant: UpdateVariant;
  readonly setProductOptions: SetProductOptions;
  readonly setProductSeo: SetProductSeo;
  readonly setProductBrand: SetProductBrand;
  readonly assignCategories: AssignCategories;
  readonly attachMedia: AttachMedia;
  readonly detachMedia: DetachMedia;
  readonly reorderMedia: ReorderMedia;
}

/** Framework-agnostic interface boundary for product use-cases (no HTTP server). */
export class ProductController {
  private readonly deps: ProductControllerDeps;

  constructor(deps: ProductControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreateProductInput): Promise<ControllerResponse> {
    return present(await this.deps.createProduct.execute(input), 201);
  }

  async publish(input: PublishProductInput): Promise<ControllerResponse> {
    return present(await this.deps.publishProduct.execute(input), 200);
  }

  async update(input: UpdateProductInput): Promise<ControllerResponse> {
    return present(await this.deps.updateProduct.execute(input), 200);
  }

  async get(input: GetProductInput): Promise<ControllerResponse> {
    return present(await this.deps.getProduct.execute(input), 200);
  }

  async getBySlug(input: GetProductBySlugInput): Promise<ControllerResponse> {
    return present(await this.deps.getProductBySlug.execute(input), 200);
  }

  async list(input: ListProductsInput): Promise<ControllerResponse> {
    return present(await this.deps.listProducts.execute(input), 200);
  }

  async schedulePublish(input: SchedulePublishProductInput): Promise<ControllerResponse> {
    return present(await this.deps.schedulePublishProduct.execute(input), 200);
  }

  async unpublish(input: UnpublishProductInput): Promise<ControllerResponse> {
    return present(await this.deps.unpublishProduct.execute(input), 200);
  }

  async archive(input: ArchiveProductInput): Promise<ControllerResponse> {
    return present(await this.deps.archiveProduct.execute(input), 200);
  }

  async delete(input: DeleteProductInput): Promise<ControllerResponse> {
    return present(await this.deps.deleteProduct.execute(input), 200);
  }

  async addVariant(input: AddVariantInput): Promise<ControllerResponse> {
    return present(await this.deps.addVariant.execute(input), 201);
  }

  async removeVariant(input: RemoveVariantInput): Promise<ControllerResponse> {
    return present(await this.deps.removeVariant.execute(input), 200);
  }

  async updateVariant(input: UpdateVariantInput): Promise<ControllerResponse> {
    return present(await this.deps.updateVariant.execute(input), 200);
  }

  async setOptions(input: SetProductOptionsInput): Promise<ControllerResponse> {
    return present(await this.deps.setProductOptions.execute(input), 200);
  }

  async setSeo(input: SetProductSeoInput): Promise<ControllerResponse> {
    return present(await this.deps.setProductSeo.execute(input), 200);
  }

  async setBrand(input: SetProductBrandInput): Promise<ControllerResponse> {
    return present(await this.deps.setProductBrand.execute(input), 200);
  }

  async assignCategories(input: AssignCategoriesInput): Promise<ControllerResponse> {
    return present(await this.deps.assignCategories.execute(input), 200);
  }

  async attachMedia(input: AttachMediaInput): Promise<ControllerResponse> {
    return present(await this.deps.attachMedia.execute(input), 201);
  }

  async detachMedia(input: DetachMediaInput): Promise<ControllerResponse> {
    return present(await this.deps.detachMedia.execute(input), 200);
  }

  async reorderMedia(input: ReorderMediaInput): Promise<ControllerResponse> {
    return present(await this.deps.reorderMedia.execute(input), 200);
  }
}
