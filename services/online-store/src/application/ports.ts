import type { DomainEvent } from "@platform/domain";

/** What a reader may know about an image: never a storage key, never a tenant (spec 1.7). */
export interface ImageDto {
  readonly url: string;
  readonly alt: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

/** Backed by Media's `ResolveMediaImages` (one batched tenant-scoped read per call). */
export interface ImageRefsPort {
  /** The subset of `ids` that are this shop's own ACTIVE assets. */
  existingIds(ids: readonly string[], tenantId: string): Promise<readonly string[]>;
  /** Resolvable ids only; a missing, archived or foreign id is simply absent. */
  resolve(ids: readonly string[], tenantId: string): Promise<Readonly<Record<string, ImageDto>>>;
}

/** Backed by `@platform/security`'s `ScryptPasswordHasher` (constant-cost compare). */
export interface StorefrontPasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}

/** The shop's primary VERIFIED hostname (tenancy, ADR-0014 8f exemption), or null. */
export interface ShopHostPort {
  primaryHostname(tenantId: string): Promise<string | null>;
}

/** Settings → General's store name (tenancy, pinned today; this adapter is the switch point). */
export interface StoreIdentityPort {
  storeName(tenantId: string): Promise<string>;
}

/** Writes events to the outbox in the caller's transaction, tenant attached at write time. */
export interface EventRecorder {
  record(events: readonly DomainEvent[], tenantId: string, tx: unknown): Promise<void>;
}

export type CatalogLinkType = "collection" | "product" | "page";

export interface LinkTarget {
  readonly href: string;
  readonly title: string;
  readonly published: boolean;
  /** The raw (unencoded) catalog slug of a collection or product; absent for pages. */
  readonly slug?: string;
}

export interface LinkTargetChoice {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
}

/** Look entries up with `Object.hasOwn` only: a link id may be `constructor` or `__proto__`. */
export type LinkTargetMap = Readonly<Record<CatalogLinkType, Readonly<Record<string, LinkTarget>>>>;

/** Collections, products and pages by id (one batched read per kind), and the picker's search. */
export interface LinkTargetsPort {
  resolve(
    ids: Readonly<Record<CatalogLinkType, readonly string[]>>,
    tenantId: string,
  ): Promise<LinkTargetMap>;
  search(
    type: CatalogLinkType,
    query: string,
    tenantId: string,
  ): Promise<readonly LinkTargetChoice[]>;
}
