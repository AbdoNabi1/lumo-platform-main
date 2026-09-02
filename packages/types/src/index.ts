/**
 * @platform/types — generic, framework-free TypeScript utility types.
 * Sprint 0.1 foundation: NO business/domain types live here.
 */

export type Nullable<T> = T | null;
export type Maybe<T> = T | null | undefined;
export type Awaitable<T> = T | Promise<T>;
export type ValueOf<T> = T[keyof T];
export type Prettify<T> = { [K in keyof T]: T[K] } & {};
export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

declare const __brand: unique symbol;
/** Nominal/branded primitive, e.g. `type UserId = Brand<string, "UserId">`. */
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

/** Discriminated result type for expected (non-exceptional) failures (a.k.a. Either). */
export type Result<T, E = Error> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** Either is an alias of {@link Result} with error-first generic ordering, for call-site clarity. */
export type Either<E, T> = Result<T, E>;

export * from "./result";

/** Cursor-paginated envelope (cursor-only, per the API architecture contract). */
export interface Paginated<T> {
  readonly items: readonly T[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: Nullable<string>;
  };
}

/**
 * Cursor pagination arguments (cursor-only per docs/architecture/04 §2). Lives here (not
 * `@platform/repository`) so domain-layer repository ports can request a page of results without
 * importing an infrastructure package (`domain-stays-pure`, dependency-cruiser) — this type and
 * {@link Paginated} are the only two pieces of the pagination contract a pure domain port needs.
 */
export interface CursorPage {
  readonly first?: number;
  readonly after?: string;
  readonly last?: number;
  readonly before?: string;
}
