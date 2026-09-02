import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork, type Database } from "@platform/db";
import type { EventSerializer } from "@platform/domain-events";
import {
  InMemoryEventBus,
  InMemoryEventPublisher,
  InMemoryOutboxStore,
  OutboxRelay,
  OutboxWriter,
  rootEventContext,
  type Subscriber,
} from "@platform/messaging";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { AddProductToCollection } from "./application/add-product-to-collection.use-case";
import { AddVariant } from "./application/add-variant.use-case";
import { ArchiveProduct } from "./application/archive-product.use-case";
import { AssignCategories } from "./application/assign-categories.use-case";
import { AttachMedia } from "./application/attach-media.use-case";
import { CreateBrand } from "./application/create-brand.use-case";
import { CreateCategory } from "./application/create-category.use-case";
import { CreateCollection } from "./application/create-collection.use-case";
import { CreateProduct } from "./application/create-product.use-case";
import { DeleteBrand } from "./application/delete-brand.use-case";
import { DeleteCategory } from "./application/delete-category.use-case";
import { DeleteCollection } from "./application/delete-collection.use-case";
import { DeleteProduct } from "./application/delete-product.use-case";
import { DetachMedia } from "./application/detach-media.use-case";
import { GetCollectionBySlug } from "./application/get-collection-by-slug.use-case";
import { GetProductBySlug } from "./application/get-product-by-slug.use-case";
import { GetProduct } from "./application/get-product.use-case";
import { ListBrands } from "./application/list-brands.use-case";
import { ListCategories } from "./application/list-categories.use-case";
import { ListCollectionProducts } from "./application/list-collection-products.use-case";
import { ListCollections } from "./application/list-collections.use-case";
import { ListProducts } from "./application/list-products.use-case";
import { MoveCategory } from "./application/move-category.use-case";
import { MoveProductBetweenCollections } from "./application/move-product-between-collections.use-case";
import { PublishCollection } from "./application/publish-collection.use-case";
import { PublishProduct } from "./application/publish-product.use-case";
import { RemoveProductFromCollection } from "./application/remove-product-from-collection.use-case";
import { RemoveVariant } from "./application/remove-variant.use-case";
import { RenameCollection } from "./application/rename-collection.use-case";
import { ReorderCollectionProducts } from "./application/reorder-collection-products.use-case";
import { ReorderMedia } from "./application/reorder-media.use-case";
import { SchedulePublishProduct } from "./application/schedule-publish-product.use-case";
import { SetProductBrand } from "./application/set-product-brand.use-case";
import { SetProductOptions } from "./application/set-product-options.use-case";
import { SetProductSeo } from "./application/set-product-seo.use-case";
import { UnpublishCollection } from "./application/unpublish-collection.use-case";
import { UnpublishProduct } from "./application/unpublish-product.use-case";
import { UpdateBrand } from "./application/update-brand.use-case";
import { UpdateProduct } from "./application/update-product.use-case";
import { UpdateVariant } from "./application/update-variant.use-case";
import type { BrandRepository } from "./domain/brand-repository";
import type { CategoryRepository } from "./domain/category-repository";
import type { CollectionRepository } from "./domain/collection-repository";
import type { ProductRepository } from "./domain/product-repository";
import { CatalogEventTranslator } from "./infrastructure/catalog-event-translator";
import { InMemoryBrandRepository } from "./infrastructure/in-memory-brand-repository";
import { InMemoryCategoryRepository } from "./infrastructure/in-memory-category-repository";
import { InMemoryCollectionRepository } from "./infrastructure/in-memory-collection-repository";
import { InMemoryProductRepository } from "./infrastructure/in-memory-product-repository";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  PrismaBrandRepository,
  PrismaCategoryRepository,
  PrismaCollectionRepository,
  PrismaProductRepository,
} from "./infrastructure/prisma-catalog-repositories";
import { BrandController } from "./interfaces/brand.controller";
import { CategoryController } from "./interfaces/category.controller";
import { CollectionController } from "./interfaces/collection.controller";
import { ProductController } from "./interfaces/product.controller";

export interface CatalogWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ all 4 Prisma repositories
   * (`PrismaProductRepository`/`PrismaCategoryRepository`/`PrismaBrandRepository`/
   * `PrismaCollectionRepository`) + `PrismaUnitOfWork` (same `prisma?`/`tenantId?`-presence
   * convention as `wireOrders`/`wireCheckout`); absent ⇒ in-memory, unchanged.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Catalog table is tenant-scoped. */
  readonly tenantId?: string;
}

export interface WiredCatalog {
  readonly products: ProductController;
  readonly categories: CategoryController;
  readonly brands: BrandController;
  /** Package-internal only — no `apps/admin` surface (Sprint 7.0 §13, "No UI" scope). */
  readonly collections: CollectionController;
  /** Drains the outbox once (relay → publisher → subscribers); returns the number published. */
  readonly drainOutbox: () => Promise<number>;
  /** Integration-event types delivered so far (for demonstration/tests). */
  readonly deliveredEventTypes: readonly string[];
}

interface CatalogRepos {
  readonly products: ProductRepository;
  readonly categories: CategoryRepository;
  readonly brands: BrandRepository;
  readonly collections: CollectionRepository;
}

/** Builds all 4 controllers from an already-wired repo set — shared by both branches so the use-case wiring is written exactly once. */
function buildControllers(
  repos: CatalogRepos,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: CatalogWiringDeps,
): {
  products: ProductController;
  categories: CategoryController;
  brands: BrandController;
  collections: CollectionController;
} {
  const { products, categories, brands, collections } = repos;
  const { idGenerator, clock } = deps;

  const productController = new ProductController({
    createProduct: new CreateProduct({ products, unitOfWork, idGenerator, clock }),
    publishProduct: new PublishProduct({ products, unitOfWork, idGenerator, clock }),
    updateProduct: new UpdateProduct({ products, unitOfWork, idGenerator, clock }),
    getProduct: new GetProduct({ products }),
    getProductBySlug: new GetProductBySlug({ products }),
    listProducts: new ListProducts({ products }),
    schedulePublishProduct: new SchedulePublishProduct({ products, unitOfWork, clock }),
    unpublishProduct: new UnpublishProduct({ products, unitOfWork, idGenerator, clock }),
    archiveProduct: new ArchiveProduct({ products, unitOfWork, idGenerator, clock }),
    deleteProduct: new DeleteProduct({ products, unitOfWork, idGenerator, clock }),
    addVariant: new AddVariant({ products, unitOfWork, idGenerator, clock }),
    removeVariant: new RemoveVariant({ products, unitOfWork, idGenerator, clock }),
    updateVariant: new UpdateVariant({ products, unitOfWork, idGenerator, clock }),
    setProductOptions: new SetProductOptions({ products, unitOfWork }),
    setProductSeo: new SetProductSeo({ products, unitOfWork }),
    setProductBrand: new SetProductBrand({ products, brands, unitOfWork }),
    assignCategories: new AssignCategories({
      products,
      categories,
      unitOfWork,
      idGenerator,
      clock,
    }),
    attachMedia: new AttachMedia({ products, unitOfWork, idGenerator, clock }),
    detachMedia: new DetachMedia({ products, unitOfWork, idGenerator, clock }),
    reorderMedia: new ReorderMedia({ products, unitOfWork, idGenerator, clock }),
  });

  const categoryController = new CategoryController({
    createCategory: new CreateCategory({ categories, unitOfWork, idGenerator, clock }),
    moveCategory: new MoveCategory({ categories, unitOfWork, idGenerator, clock }),
    deleteCategory: new DeleteCategory({ categories, unitOfWork, idGenerator, clock }),
    listCategories: new ListCategories({ categories }),
  });

  const brandController = new BrandController({
    createBrand: new CreateBrand({ brands, unitOfWork, idGenerator, clock }),
    updateBrand: new UpdateBrand({ brands, unitOfWork, idGenerator, clock }),
    deleteBrand: new DeleteBrand({ brands, unitOfWork, idGenerator, clock }),
    listBrands: new ListBrands({ brands }),
  });

  const collectionController = new CollectionController({
    createCollection: new CreateCollection({ collections, unitOfWork, idGenerator, clock }),
    renameCollection: new RenameCollection({ collections, unitOfWork, idGenerator, clock }),
    addProductToCollection: new AddProductToCollection({
      collections,
      products,
      unitOfWork,
      idGenerator,
      clock,
    }),
    removeProductFromCollection: new RemoveProductFromCollection({
      collections,
      unitOfWork,
      idGenerator,
      clock,
    }),
    reorderCollectionProducts: new ReorderCollectionProducts({
      collections,
      unitOfWork,
      idGenerator,
      clock,
    }),
    moveProductBetweenCollections: new MoveProductBetweenCollections({
      collections,
      unitOfWork,
      idGenerator,
      clock,
    }),
    publishCollection: new PublishCollection({ collections, unitOfWork, idGenerator, clock }),
    unpublishCollection: new UnpublishCollection({ collections, unitOfWork, idGenerator, clock }),
    deleteCollection: new DeleteCollection({ collections, unitOfWork, idGenerator, clock }),
    listCollections: new ListCollections({ collections }),
    getCollectionBySlug: new GetCollectionBySlug({ collections }),
    listCollectionProducts: new ListCollectionProducts({ collections, products }),
  });

  return {
    products: productController,
    categories: categoryController,
    brands: brandController,
    collections: collectionController,
  };
}

const CATALOG_EVENT_TYPES = [
  "catalog.product.created.v1",
  "catalog.product.published.v1",
  "catalog.product.updated.v1",
  "catalog.product.unpublished.v1",
  "catalog.product.archived.v1",
  "catalog.product.deleted.v1",
  "catalog.product.variant_added.v1",
  "catalog.product.variant_removed.v1",
  "catalog.product.variant_updated.v1",
  "catalog.product.categorized.v1",
  "catalog.product.media_attached.v1",
  "catalog.product.media_detached.v1",
  "catalog.product.media_reordered.v1",
  "catalog.brand.created.v1",
  "catalog.brand.updated.v1",
  "catalog.brand.deleted.v1",
  "catalog.category.created.v1",
  "catalog.category.moved.v1",
  "catalog.category.deleted.v1",
  "catalog.collection.created.v1",
  "catalog.collection.renamed.v1",
  "catalog.collection.product_added.v1",
  "catalog.collection.product_removed.v1",
  "catalog.collection.products_reordered.v1",
  "catalog.collection.published.v1",
  "catalog.collection.unpublished.v1",
  "catalog.collection.deleted.v1",
] as const;

/**
 * Composition root for the Catalog context. Prisma slice (all 4 repositories +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory + in-memory relay/publisher.
 */
export function wireCatalog(deps: CatalogWiringDeps): WiredCatalog {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wireCatalog: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new CatalogEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "catalog",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const prismaDeps = { prisma: deps.prisma, tenantId, outbox, context };
    const repos: CatalogRepos = {
      products: new PrismaProductRepository(prismaDeps),
      categories: new PrismaCategoryRepository(prismaDeps),
      brands: new PrismaBrandRepository(prismaDeps),
      collections: new PrismaCollectionRepository(prismaDeps),
    };
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);
    const controllers = buildControllers(repos, unitOfWork, deps);

    return { ...controllers, drainOutbox: async () => 0, deliveredEventTypes: [] };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new CatalogEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "catalog",
  });
  const context = rootEventContext(deps.idGenerator);

  const repos: CatalogRepos = {
    products: new InMemoryProductRepository({ outbox: outboxWriter, context }),
    categories: new InMemoryCategoryRepository({ outbox: outboxWriter, context }),
    brands: new InMemoryBrandRepository({ outbox: outboxWriter, context }),
    collections: new InMemoryCollectionRepository({ outbox: outboxWriter, context }),
  };
  const unitOfWork = new InMemoryUnitOfWork();
  const controllers = buildControllers(repos, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const type of CATALOG_EVENT_TYPES) {
    bus.subscribe(type, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    ...controllers,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
