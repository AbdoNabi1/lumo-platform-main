import { Prisma } from "@prisma/client";
import type { Database, TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Brand } from "../domain/brand";
import type { BrandRepository } from "../domain/brand-repository";
import type { Category } from "../domain/category";
import type { CategoryRepository } from "../domain/category-repository";
import type { Collection } from "../domain/collection";
import type { CollectionRepository } from "../domain/collection-repository";
import type { Product } from "../domain/product";
import type { ProductRepository } from "../domain/product-repository";
import {
  BrandMapper,
  CategoryMapper,
  CollectionMapper,
  ProductMapper,
  type ProductRow,
  type VariantRow,
} from "./catalog.mappers";

/** Prisma requires an explicit SQL-NULL sentinel for nullable `Json?` columns — bare `null` is ambiguous. */
function jsonOrDbNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

export interface PrismaCatalogRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  /** Tenant scope for every query (ADR-0008 §2) — injected by the composition root. */
  readonly tenantId: string;
}

function requireTx(tx: unknown, repo: string): TransactionClient {
  if (tx === undefined || tx === null) {
    throw new Error(`${repo}.save requires the unit of work's transaction client (ADR-0003).`);
  }
  return tx as TransactionClient;
}

/**
 * Production `ProductRepository` on the `catalog` schema. The variant set is owned by the
 * aggregate; each save reconciles it (create-missing, delete-removed, update-changed).
 * Optimistic locking + same-transaction outbox per ADR-0003.
 */
export class PrismaProductRepository implements ProductRepository {
  private readonly deps: PrismaCatalogRepositoryDeps;

  constructor(deps: PrismaCatalogRepositoryDeps) {
    this.deps = deps;
  }

  async save(product: Product, tx?: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaProductRepository");
    const tenantId = this.deps.tenantId;

    const productRow = ProductMapper.toProductRow(product, tenantId);
    const productData = { ...productRow, seo: jsonOrDbNull(productRow.seo) };
    if (product.version === 0) {
      await client.product.create({ data: productData });
    } else {
      const updated = await client.product.updateMany({
        where: { id: product.id.toString(), tenantId, version: product.version },
        data: { ...productData, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Product ${product.id.toString()} was modified concurrently (expected version ${product.version})`,
        );
      }
    }

    const variantIds = product.variants.map((v) => v.id.toString());
    await client.productVariant.deleteMany({
      where: { productId: product.id.toString(), tenantId, id: { notIn: variantIds } },
    });
    for (const row of ProductMapper.toVariantRows(product, tenantId)) {
      const data = { ...row, selection: jsonOrDbNull(row.selection) };
      await client.productVariant.upsert({ where: { id: row.id }, create: data, update: data });
    }

    await this.deps.outbox.write(product.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<Product | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.product.findFirst({
      where: { id, tenantId: this.deps.tenantId, deletedAt: null },
      include: { variants: true },
    });
    return row === null
      ? null
      : ProductMapper.toDomain(
          // Prisma row's `options: JsonValue` has no structural overlap with `ProductRow`'s
          // `readonly { name: string; values: readonly string[] }[]` (comparability fails).
          row as unknown as ProductRow,
          row.variants as VariantRow[],
        );
  }

  async findBySlug(slug: string, tx?: unknown): Promise<Product | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.product.findFirst({
      where: { slug, tenantId: this.deps.tenantId, deletedAt: null },
      include: { variants: true },
    });
    return row === null
      ? null
      : ProductMapper.toDomain(
          // Prisma row's `options: JsonValue` has no structural overlap with `ProductRow`'s
          // `readonly { name: string; values: readonly string[] }[]` (comparability fails).
          row as unknown as ProductRow,
          row.variants as VariantRow[],
        );
  }

  async findBySku(sku: string, tx?: unknown): Promise<Product | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.product.findFirst({
      where: { sku, tenantId: this.deps.tenantId, deletedAt: null },
      include: { variants: true },
    });
    return row === null
      ? null
      : ProductMapper.toDomain(
          // Prisma row's `options: JsonValue` has no structural overlap with `ProductRow`'s
          // `readonly { name: string; values: readonly string[] }[]` (comparability fails).
          row as unknown as ProductRow,
          row.variants as VariantRow[],
        );
  }

  async delete(product: Product, tx?: unknown): Promise<void> {
    await this.save(product, tx);
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<Product>> {
    return this.paginate({}, page, tx);
  }

  async search(query: string, page: CursorPage, tx?: unknown): Promise<Paginated<Product>> {
    return this.paginate(
      {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { sku: { contains: query, mode: "insensitive" } },
          { slug: { contains: query, mode: "insensitive" } },
        ],
      },
      page,
      tx,
    );
  }

  private async paginate(
    where: Record<string, unknown>,
    page: CursorPage,
    tx?: unknown,
  ): Promise<Paginated<Product>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.product.findMany({
      where: {
        ...where,
        tenantId: this.deps.tenantId,
        deletedAt: null,
        ...(after ? { id: { gt: after } } : {}),
      },
      include: { variants: true },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    // Prisma row's `options: JsonValue` has no structural overlap with `ProductRow`'s
    // `readonly { name: string; values: readonly string[] }[]` (comparability fails).
    const products = rows.map((row) =>
      ProductMapper.toDomain(row as unknown as ProductRow, row.variants as VariantRow[]),
    );
    return buildPaginatedPage(products, limit, (p) => p.id.toString());
  }
}

/** Production `CategoryRepository` on the `catalog` schema (ADR-0003 locking + same-tx outbox). */
export class PrismaCategoryRepository implements CategoryRepository {
  private readonly deps: PrismaCatalogRepositoryDeps;

  constructor(deps: PrismaCatalogRepositoryDeps) {
    this.deps = deps;
  }

  async save(category: Category, tx?: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaCategoryRepository");
    const tenantId = this.deps.tenantId;

    if (category.version === 0) {
      await client.category.create({ data: CategoryMapper.toRow(category, tenantId) });
    } else {
      const updated = await client.category.updateMany({
        where: { id: category.id.toString(), tenantId, version: category.version },
        data: { ...CategoryMapper.toRow(category, tenantId), version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Category ${category.id.toString()} was modified concurrently (expected version ${category.version})`,
        );
      }
    }

    await this.deps.outbox.write(category.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<Category | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.category.findFirst({
      where: { id, tenantId: this.deps.tenantId, deletedAt: null },
    });
    return row === null ? null : CategoryMapper.toDomain(row);
  }

  async findBySlug(slug: string, tx?: unknown): Promise<Category | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.category.findFirst({
      where: { slug, tenantId: this.deps.tenantId, deletedAt: null },
    });
    return row === null ? null : CategoryMapper.toDomain(row);
  }

  async delete(category: Category, tx?: unknown): Promise<void> {
    await this.save(category, tx);
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<Category>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.category.findMany({
      where: {
        tenantId: this.deps.tenantId,
        deletedAt: null,
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      rows.map((row) => CategoryMapper.toDomain(row)),
      limit,
      (c) => c.id.toString(),
    );
  }

  async hasChildren(id: string, tx?: unknown): Promise<boolean> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const child = await client.category.findFirst({
      where: { parentId: id, tenantId: this.deps.tenantId, deletedAt: null },
      select: { id: true },
    });
    return child !== null;
  }
}

/** Production `BrandRepository` on the `catalog` schema (Commerce Sprint 1). */
export class PrismaBrandRepository implements BrandRepository {
  private readonly deps: PrismaCatalogRepositoryDeps;

  constructor(deps: PrismaCatalogRepositoryDeps) {
    this.deps = deps;
  }

  async save(brand: Brand, tx?: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaBrandRepository");
    const tenantId = this.deps.tenantId;

    if (brand.version === 0) {
      await client.brand.create({ data: BrandMapper.toRow(brand, tenantId) });
    } else {
      const updated = await client.brand.updateMany({
        where: { id: brand.id.toString(), tenantId, version: brand.version },
        data: { ...BrandMapper.toRow(brand, tenantId), version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Brand ${brand.id.toString()} was modified concurrently (expected version ${brand.version})`,
        );
      }
    }

    await this.deps.outbox.write(brand.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<Brand | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.brand.findFirst({
      where: { id, tenantId: this.deps.tenantId, deletedAt: null },
    });
    return row === null ? null : BrandMapper.toDomain(row);
  }

  async findBySlug(slug: string, tx?: unknown): Promise<Brand | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.brand.findFirst({
      where: { slug, tenantId: this.deps.tenantId, deletedAt: null },
    });
    return row === null ? null : BrandMapper.toDomain(row);
  }

  async delete(brand: Brand, tx?: unknown): Promise<void> {
    await this.save(brand, tx);
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<Brand>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.brand.findMany({
      where: {
        tenantId: this.deps.tenantId,
        deletedAt: null,
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      rows.map((row) => BrandMapper.toDomain(row)),
      limit,
      (b) => b.id.toString(),
    );
  }
}

/** Production `CollectionRepository` on the `catalog` schema (Sprint 7.0). */
export class PrismaCollectionRepository implements CollectionRepository {
  private readonly deps: PrismaCatalogRepositoryDeps;

  constructor(deps: PrismaCatalogRepositoryDeps) {
    this.deps = deps;
  }

  async save(collection: Collection, tx?: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaCollectionRepository");
    const tenantId = this.deps.tenantId;
    const row = CollectionMapper.toRow(collection, tenantId);

    if (collection.version === 0) {
      await client.collection.create({ data: row });
    } else {
      const updated = await client.collection.updateMany({
        where: { id: row.id, tenantId, version: collection.version },
        data: { ...row, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Collection ${row.id} was modified concurrently (expected version ${collection.version})`,
        );
      }
    }

    // Reconcile the ordered item set (mirrors ProductVariant reconciliation above).
    await client.collectionItem.deleteMany({ where: { collectionId: row.id, tenantId } });
    const items = CollectionMapper.toItemRows(collection, tenantId);
    if (items.length > 0) {
      await client.collectionItem.createMany({ data: items });
    }

    await this.deps.outbox.write(collection.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<Collection | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.collection.findFirst({
      where: { id, tenantId: this.deps.tenantId, deletedAt: null },
      include: { items: true },
    });
    return row === null ? null : CollectionMapper.toDomain(row, row.items);
  }

  async findBySlug(slug: string, tx?: unknown): Promise<Collection | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.collection.findFirst({
      where: { slug, tenantId: this.deps.tenantId, deletedAt: null },
      include: { items: true },
    });
    return row === null ? null : CollectionMapper.toDomain(row, row.items);
  }

  async delete(collection: Collection, tx?: unknown): Promise<void> {
    await this.save(collection, tx);
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<Collection>> {
    return this.paginate({}, page, tx);
  }

  async search(query: string, page: CursorPage, tx?: unknown): Promise<Paginated<Collection>> {
    return this.paginate(
      {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { slug: { contains: query, mode: "insensitive" } },
        ],
      },
      page,
      tx,
    );
  }

  private async paginate(
    where: Record<string, unknown>,
    page: CursorPage,
    tx?: unknown,
  ): Promise<Paginated<Collection>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.collection.findMany({
      where: {
        ...where,
        tenantId: this.deps.tenantId,
        deletedAt: null,
        ...(after ? { id: { gt: after } } : {}),
      },
      include: { items: true },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      rows.map((row) => CollectionMapper.toDomain(row, row.items)),
      limit,
      (c) => c.id.toString(),
    );
  }
}
