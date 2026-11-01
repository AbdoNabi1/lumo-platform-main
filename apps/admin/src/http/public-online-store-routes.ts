import { z } from "zod";
import type { RateLimiter } from "@platform/contracts";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

/** Scrypt runs on this anonymous route, so the raw length is capped before anything else happens. */
const unlockBody = z.object({ password: z.string().max(200) }).strict();
const UNLOCK_LIMIT = 20;
const UNLOCK_WINDOW_MS = 10 * 60 * 1000;

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
      handle: ({ context }) => {
        const header = context.headers?.["x-preview-token"];
        // A repeated header is not a token: "" keeps it a refused preview, never a live 200. The use
        // case refuses every bad token with one answer, and the storefront gate reads 200 as valid.
        const previewToken = Array.isArray(header) ? "" : header;
        return admin.publicReads.onlineStore.shell(context.tenantId, previewToken);
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
      handle: ({ context }) => admin.publicReads.onlineStore.access(context.tenantId),
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
        if (rateLimiter !== undefined) {
          const decision = await rateLimiter.consume(
            `rl:${context.tenantId}:storefront-unlock`,
            UNLOCK_LIMIT,
            UNLOCK_WINDOW_MS,
          );
          if (!decision.allowed) {
            return {
              status: 429,
              body: {
                code: "RATE_LIMITED",
                message: "Too many attempts",
                retryable: true,
                fields: [],
                retryAfterMs: decision.retryAfterMs,
              },
              headers: {
                "retry-after": String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))),
              },
            };
          }
        }
        return admin.publicReads.onlineStore.unlock(context.tenantId, body.password);
      },
    }),
  ] as readonly RouteDefinition[];
}
