import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { RateLimiter } from "@platform/contracts";
import type { WiredAdmin } from "../composition";
import {
  staffIdentifier,
  STAFF_IDENTIFIER_PREFIX,
} from "../interfaces/staff-auth.admin-controller";

const staffLoginBody = z
  .object({
    email: z.string().min(3).max(320),
    password: z.string().min(1).max(256),
  })
  .strict();

const STAFF_LOGIN_LIMIT = 10;
const STAFF_LOGIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Plan 1B-2: native staff sign-in. Public (no principal yet) but tenant-resolved like every route.
 * NOT idempotent, for the same reason as the customer `/public/auth/login`: a replayed login response
 * would hand a second caller the first caller's token.
 *
 * `rateLimiter` is optional, like `publicAuthRoutes`' (tests that don't care keep compiling); the real
 * wiring in `admin-routes.ts` always passes it. The bucket is per tenant + normalised email (the same
 * normalisation `staffIdentifier` applies) and counts every attempt, successful or not, whether or not
 * the account exists — so a refusal reveals nothing about the account.
 */
export function publicStaffAuthRoutes(
  admin: WiredAdmin,
  rateLimiter?: RateLimiter,
): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/public/auth/staff/login",
      version: 1,
      permission: "security:authenticate",
      public: true,
      summary: "Public: sign a staff member in with email and password (native auth)",
      schema: { body: staffLoginBody },
      handle: async ({ body, context }) => {
        if (rateLimiter !== undefined) {
          const normalised = staffIdentifier(body.email).slice(STAFF_IDENTIFIER_PREFIX.length);
          const key = `rl:${context.tenantId}:staff-login:${normalised}`;
          const decision = await rateLimiter.consume(key, STAFF_LOGIN_LIMIT, STAFF_LOGIN_WINDOW_MS);
          if (!decision.allowed) {
            return {
              status: 429,
              body: {
                code: "RATE_LIMITED",
                message: "Too many sign-in attempts for this email",
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
        return admin.staffAuth.login({
          tenantId: context.tenantId,
          email: body.email,
          password: body.password,
        });
      },
    }),
    defineRoute({
      method: "GET",
      path: "/public/auth/jwks",
      version: 1,
      permission: "security:authenticate",
      public: true,
      summary: "Public: the platform token issuer's public keys (JWKS)",
      schema: {},
      handle: () => admin.staffAuth.jwks(),
    }),
  ];
}
