import type { CursorPage, Paginated } from "@platform/types";

export type { CursorPage } from "@platform/types";

/**
 * Generic persistence abstractions (ports). Interfaces ONLY — no concrete repositories or
 * implementations. Domain repositories implement these per bounded context in later sprints,
 * keeping persistence behind a port (clean architecture, docs/architecture/02). The Prisma
 * adapter foundation that implements these lives in the infrastructure package `@platform/db`.
 */

/** A persistence port for an aggregate of type `TEntity` keyed by `TId`. */
export interface Repository<TEntity, TId> {
  findById(id: TId): Promise<TEntity | null>;
  save(entity: TEntity): Promise<TEntity>;
  delete(id: TId): Promise<void>;
}

/** Groups repository operations into a single atomic transaction boundary. */
export interface UnitOfWork {
  run<T>(work: () => Promise<T>): Promise<T>;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/**
 * Cursor over a sort key (Sprint 7.0: first real consumer, Commerce Core `list`/`search`). The
 * encoding is the identity function — callers must still treat the value as opaque (it may change),
 * but this package stays framework/runtime-free (no `Buffer`, no Node dependency) rather than adding
 * one purely to obscure a value that carries no sensitive information (it's already the row's own id).
 */
export function encodeCursor(sortKey: string): string {
  return sortKey;
}

export function decodeCursor(cursor: string): string {
  return cursor;
}

/**
 * Builds a {@link Paginated} envelope from rows fetched ordered-ascending-by-sort-key with a
 * `first + 1` limit (the caller over-fetches by one to detect `hasNextPage` without a second query).
 * `sortKeyOf` extracts the per-row key the cursor is opaque over (an id is sufficient whenever the
 * id itself is monotonically sortable, e.g. UUIDv7 — D-022).
 */
export function buildPaginatedPage<T>(
  overFetchedRows: readonly T[],
  first: number,
  sortKeyOf: (row: T) => string,
): {
  readonly items: readonly T[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
} {
  const hasNextPage = overFetchedRows.length > first;
  const items = hasNextPage ? overFetchedRows.slice(0, first) : overFetchedRows;
  const endCursor = items.length > 0 ? encodeCursor(sortKeyOf(items[items.length - 1] as T)) : null;
  return { items, pageInfo: { hasNextPage, endCursor } };
}

/** Clamps a requested page size into `[1, MAX_PAGE_SIZE]`, defaulting to `DEFAULT_PAGE_SIZE`. */
export function normalizePageSize(first: number | undefined): number {
  if (first === undefined) return DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(first, MAX_PAGE_SIZE));
}

/** Read side of a persistence port. */
export interface ReadRepository<TEntity, TId> {
  findById(id: TId): Promise<TEntity | null>;
  exists(id: TId): Promise<boolean>;
  findPage(page: CursorPage): Promise<Paginated<TEntity>>;
}

/** Write side of a persistence port. */
export interface WriteRepository<TEntity, TId> {
  save(entity: TEntity): Promise<TEntity>;
  delete(id: TId): Promise<void>;
}

/**
 * A transaction boundary that exposes the transaction-scoped context to the work callback
 * (e.g. a Prisma interactive transaction client). Implemented by an infrastructure adapter.
 *
 * Seam contract (ADR-0003): the use case receives `context` from `run` and passes it to **every**
 * repository call inside the boundary (`repo.save(aggregate, tx)`, `repo.findById(id, tx)`).
 * Repository ports accept it as a trailing optional `tx?: unknown`; adapters that need a real
 * transaction (Prisma) narrow it and MUST fail loudly when it is missing, so the aggregate write
 * and its outbox append always commit atomically. The in-memory adapters ignore it.
 */
export interface TransactionalUnitOfWork<TContext> {
  run<T>(work: (context: TContext) => Promise<T>): Promise<T>;
}
