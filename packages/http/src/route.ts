import type { z } from "zod";
import type { Permission, Principal } from "@platform/contracts";

/** Everything a handler may use — resolved by middleware BEFORE the handler runs. */
export interface RequestContext {
  readonly tenantId: string;
  readonly principal: Principal;
  readonly requestId: string;
  readonly correlationId: string;
  /**
   * The exact bytes received on the wire, before zod parsing (C2-2). A third-party webhook signs
   * these bytes verbatim — re-serializing the already-parsed `body` can never reproduce them
   * byte-for-byte (key order, whitespace, numeric formatting all vary), so a route verifying a
   * signature MUST use this instead of `JSON.stringify(body)`. Always populated for a JSON request
   * body (`createHttpServer`'s content-type parser captures it before parsing); `undefined` for a
   * request with no body.
   */
  readonly rawBody?: Uint8Array;
  /**
   * The raw request headers (C2-2) — needed by any route whose authenticity check is a header a
   * third party sets itself (e.g. `Stripe-Signature`), which by definition cannot be a zod-parsed
   * body field. Fastify's own header value shape (a single value is usually a `string`; a
   * repeated header becomes `string[]`).
   */
  readonly headers?: Readonly<Record<string, string | string[] | undefined>>;
}

export interface TransportResponse {
  readonly status: number;
  readonly body: unknown;
  /**
   * G0-3 (launch-readiness review): response headers a transport MUST forward verbatim — today
   * only `retry-after` on the rate-limit 429/503 responses (`createHttpServer`'s rate-limit step).
   * `retryAfterMs` already lived in the JSON body, but a proxy, HTTP client, or SDK reads the
   * standard `Retry-After` header (RFC 9110 §10.2.3), never a body field — without this, every
   * caller retries immediately instead of backing off, which is the opposite of what the 503/429
   * exists to communicate under a real backing-store outage.
   */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * A framework-independent route definition (D-047). The handler receives PARSED input and the
 * request context and returns a transport-neutral response — exactly the shape the existing
 * context controllers already produce, so routes delegate with zero business logic. Fastify,
 * zod parsing, OpenAPI generation, and middleware are wired by `createHttpServer`; nothing in a
 * route definition imports Fastify.
 */
export interface RouteDefinition<TBody = unknown, TParams = unknown, TQuery = unknown> {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path WITHOUT the version prefix, e.g. `/products`. */
  readonly path: string;
  /** API version — becomes the `/api/v<n>` prefix and the OpenAPI tag group. */
  readonly version: 1;
  /** Required permission (`"<module>:<action>"`); enforced via the injected guard (ADR-0007/0009).
   * Advisory-only (OpenAPI tagging) when {@link public} is `true` — a public route runs no guard. */
  readonly permission: Permission;
  /** Idempotency-key support for unsafe methods (Sprint 2.3 store; replay via cache). */
  readonly idempotent?: boolean;
  /**
   * Phase 9 hardening (public storefront reads): when `true`, the route skips authentication and
   * the permission guard entirely — anonymous traffic is accepted, resolved to a fixed `customer`
   * principal (`id: "public"`, no roles), and rate-limited per caller IP rather than per principal
   * (the default per-principal bucket would otherwise let one visitor's traffic throttle every
   * other visitor of the same tenant). Tenant resolution, validation, and idempotency are
   * unaffected — this is the same pipeline, not a parallel one. Absent ⇒ existing behavior,
   * unchanged (authenticated + guarded), for every route defined before this field existed.
   */
  readonly public?: boolean;
  readonly summary: string;
  readonly schema: {
    readonly body?: z.ZodType<TBody>;
    readonly params?: z.ZodType<TParams>;
    readonly querystring?: z.ZodType<TQuery>;
  };
  handle(input: {
    readonly body: TBody;
    readonly params: TParams;
    readonly query: TQuery;
    readonly context: RequestContext;
  }): Promise<TransportResponse>;
}

/** Identity helper that preserves inference for route authors. */
export function defineRoute<TBody, TParams, TQuery>(
  route: RouteDefinition<TBody, TParams, TQuery>,
): RouteDefinition<TBody, TParams, TQuery> {
  return route;
}
