import { z } from "zod";
import type { RateLimitDecision, RateLimiter } from "@platform/contracts";
import {
  defineRoute,
  type RequestContext,
  type RouteDefinition,
  type TransportResponse,
} from "@platform/http";
import { logger } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import { rateLimited } from "./rate-limited-response";
import { uncached } from "./uncached-response";

/** Scrypt runs on this anonymous route, so the raw length is capped before anything else happens. */
const unlockBody = z.object({ password: z.string().max(200) }).strict();
const UNLOCK_LIMIT = 20;
const UNLOCK_WINDOW_MS = 10 * 60 * 1000;
const LIMITER_RETRY_MS = 5_000;

/** The same 503 `packages/http` answers when its own limiter is down. */
function limiterUnavailable(context: RequestContext, reason: string): TransportResponse {
  logger.error("rate limiter unavailable; failing closed", {
    requestId: context.requestId,
    route: "/public/online-store/unlock",
    error: reason,
  });
  return {
    status: 503,
    body: {
      code: "UNAVAILABLE",
      message: "Service temporarily unavailable",
      retryable: true,
      fields: [],
      retryAfterMs: LIMITER_RETRY_MS,
    },
    headers: { "retry-after": String(Math.ceil(LIMITER_RETRY_MS / 1000)) },
  };
}

/** Null lets the attempt through. A password check on an anonymous route never runs unlimited. */
async function refuseUnlock(
  rateLimiter: RateLimiter | undefined,
  context: RequestContext,
): Promise<TransportResponse | null> {
  if (rateLimiter === undefined) return limiterUnavailable(context, "no rate limiter configured");
  let decision: RateLimitDecision;
  try {
    decision = await rateLimiter.consume(
      `rl:${context.tenantId}:storefront-unlock`,
      UNLOCK_LIMIT,
      UNLOCK_WINDOW_MS,
    );
  } catch (error) {
    return limiterUnavailable(context, error instanceof Error ? error.message : String(error));
  }
  return decision.allowed ? null : rateLimited(decision.retryAfterMs, "Too many attempts");
}

/**
 * Spec 1.10: the storefront's anonymous reads of the Online Store, plus the unlock check. Each calls
 * a `publicReads.onlineStore` closure with the request's tenant. The rate limit is per SHOP (spec
 * decision 20: the Runtime only sees the storefront server's IP). `permission` is advisory, as on
 * every public route: `public: true` means no guard runs, so the unlock route carries its own limit.
 */
export function publicOnlineStoreRoutes(
  admin: WiredAdmin,
  rateLimiter?: RateLimiter,
): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/public/online-store",
      version: 1,
      permission: "online_store:read",
      public: true,
      summary:
        "Public: the storefront shell (brand, preferences, header, footer, lock); the draft with x-preview-token",
      schema: {},
      handle: async ({ context }) => {
        const header = context.headers?.["x-preview-token"];
        // A repeated header is not a token: "" keeps it a refused preview, never a live 200. The use
        // case refuses every bad token with one answer, and the storefront gate reads 200 as valid.
        const previewToken = Array.isArray(header) ? "" : header;
        return uncached(await admin.publicReads.onlineStore.shell(context.tenantId, previewToken));
      },
    }),
    defineRoute({
      method: "GET",
      path: "/public/online-store/home",
      version: 1,
      permission: "online_store:read",
      public: true,
      summary:
        "Public: the homepage sections, resolved (Part 3); the draft's, flagged, with x-preview-token",
      schema: {},
      handle: async ({ context }) => {
        const header = context.headers?.["x-preview-token"];
        // The shell's rule: a repeated header is a refused preview (""), never the live home.
        const previewToken = Array.isArray(header) ? "" : header;
        return uncached(await admin.publicReads.onlineStore.home(context.tenantId, previewToken));
      },
    }),
    defineRoute({
      method: "GET",
      path: "/public/online-store/access",
      version: 1,
      permission: "online_store:read",
      public: true,
      summary:
        "Public: whether the storefront is locked, its access version and the visitor message",
      schema: {},
      handle: async ({ context }) =>
        uncached(await admin.publicReads.onlineStore.access(context.tenantId)),
    }),
    defineRoute({
      method: "POST",
      path: "/public/online-store/unlock",
      version: 1,
      permission: "online_store:read",
      public: true,
      // NOT idempotent: a cached 200 must never be replayed for a different (wrong) password.
      summary: "Public: check the storefront password (20 attempts per 10 minutes per shop)",
      schema: { body: unlockBody },
      handle: async ({ body, context }) => {
        const refused = await refuseUnlock(rateLimiter, context);
        return refused ?? admin.publicReads.onlineStore.unlock(context.tenantId, body.password);
      },
    }),
  ] as readonly RouteDefinition[];
}
