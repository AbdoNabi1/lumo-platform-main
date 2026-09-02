import type {
  AddProductToCollection,
  AddProductToCollectionInput,
} from "../application/add-product-to-collection.use-case";
import type {
  CreateCollection,
  CreateCollectionInput,
} from "../application/create-collection.use-case";
import type {
  DeleteCollection,
  DeleteCollectionInput,
} from "../application/delete-collection.use-case";
import type {
  GetCollectionBySlug,
  GetCollectionBySlugInput,
} from "../application/get-collection-by-slug.use-case";
import type {
  ListCollectionProducts,
  ListCollectionProductsInput,
} from "../application/list-collection-products.use-case";
import type {
  ListCollections,
  ListCollectionsInput,
} from "../application/list-collections.use-case";
import type {
  MoveProductBetweenCollections,
  MoveProductBetweenCollectionsInput,
} from "../application/move-product-between-collections.use-case";
import type {
  PublishCollection,
  PublishCollectionInput,
} from "../application/publish-collection.use-case";
import type {
  RemoveProductFromCollection,
  RemoveProductFromCollectionInput,
} from "../application/remove-product-from-collection.use-case";
import type {
  ReorderCollectionProducts,
  ReorderCollectionProductsInput,
} from "../application/reorder-collection-products.use-case";
import type {
  RenameCollection,
  RenameCollectionInput,
} from "../application/rename-collection.use-case";
import type {
  UnpublishCollection,
  UnpublishCollectionInput,
} from "../application/unpublish-collection.use-case";
import { type ControllerResponse, present } from "./presenter";

export interface CollectionControllerDeps {
  readonly createCollection: CreateCollection;
  readonly renameCollection: RenameCollection;
  readonly addProductToCollection: AddProductToCollection;
  readonly removeProductFromCollection: RemoveProductFromCollection;
  readonly reorderCollectionProducts: ReorderCollectionProducts;
  readonly moveProductBetweenCollections: MoveProductBetweenCollections;
  readonly publishCollection: PublishCollection;
  readonly unpublishCollection: UnpublishCollection;
  readonly deleteCollection: DeleteCollection;
  readonly listCollections: ListCollections;
  readonly getCollectionBySlug: GetCollectionBySlug;
  readonly listCollectionProducts: ListCollectionProducts;
}

/**
 * Framework-agnostic interface boundary for collection use-cases (no HTTP server). Package-internal
 * only — Sprint 7.0 explicitly deferred Collection's admin/HTTP surface ("No UI" scope); this
 * controller is wired into `wireCatalog` but not exposed through `apps/admin`.
 */
export class CollectionController {
  private readonly deps: CollectionControllerDeps;

  constructor(deps: CollectionControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreateCollectionInput): Promise<ControllerResponse> {
    return present(await this.deps.createCollection.execute(input), 201);
  }

  async rename(input: RenameCollectionInput): Promise<ControllerResponse> {
    return present(await this.deps.renameCollection.execute(input), 200);
  }

  async addProduct(input: AddProductToCollectionInput): Promise<ControllerResponse> {
    return present(await this.deps.addProductToCollection.execute(input), 200);
  }

  async removeProduct(input: RemoveProductFromCollectionInput): Promise<ControllerResponse> {
    return present(await this.deps.removeProductFromCollection.execute(input), 200);
  }

  async reorderProducts(input: ReorderCollectionProductsInput): Promise<ControllerResponse> {
    return present(await this.deps.reorderCollectionProducts.execute(input), 200);
  }

  async moveProductBetweenCollections(
    input: MoveProductBetweenCollectionsInput,
  ): Promise<ControllerResponse> {
    return present(await this.deps.moveProductBetweenCollections.execute(input), 200);
  }

  async publish(input: PublishCollectionInput): Promise<ControllerResponse> {
    return present(await this.deps.publishCollection.execute(input), 200);
  }

  async unpublish(input: UnpublishCollectionInput): Promise<ControllerResponse> {
    return present(await this.deps.unpublishCollection.execute(input), 200);
  }

  async delete(input: DeleteCollectionInput): Promise<ControllerResponse> {
    return present(await this.deps.deleteCollection.execute(input), 200);
  }

  async list(input: ListCollectionsInput): Promise<ControllerResponse> {
    return present(await this.deps.listCollections.execute(input), 200);
  }

  async getBySlug(input: GetCollectionBySlugInput): Promise<ControllerResponse> {
    return present(await this.deps.getCollectionBySlug.execute(input), 200);
  }

  /** Paginated, published-only products in one collection's curated order (T5.20). */
  async listMemberProducts(input: ListCollectionProductsInput): Promise<ControllerResponse> {
    return present(await this.deps.listCollectionProducts.execute(input), 200);
  }
}
