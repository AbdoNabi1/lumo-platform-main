import type { Result } from "./index";

/**
 * Constructors and combinators for the `Result` type (a.k.a. Either: success `value` or
 * failure `error`). Pure and framework-free — usable by domain, application, and infrastructure
 * layers without violating Clean Architecture boundaries.
 */

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(
  result: Result<T, E>,
): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}

export function isErr<T, E>(
  result: Result<T, E>,
): result is { readonly ok: false; readonly error: E } {
  return !result.ok;
}

export function map<T, E, U>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

export function mapError<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

export function match<T, E, U>(
  result: Result<T, E>,
  handlers: { readonly onOk: (value: T) => U; readonly onErr: (error: E) => U },
): U {
  return result.ok ? handlers.onOk(result.value) : handlers.onErr(result.error);
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
