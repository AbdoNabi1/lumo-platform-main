import { z } from "zod";
import { defineRoute, type RequestContext, type RouteDefinition } from "@platform/http";
import type { RateLimiter } from "@platform/contracts";
import { ScryptPasswordHasher } from "@platform/security";
import { logger } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import { rateLimited } from "./public-staff-auth-routes";

const signupBody = z
  .object({
    storeName: z.string().trim().min(2).max(60),
    email: z
      .string()
      .min(3)
      .max(320)
      .refine((value) => value.includes("@"), "must be an email address"),
    password: z.string().min(8).max(256),
    country: z.enum(["EG", "SA", "AE"]),
  })
  .strict();
const loginBody = z
  .object({ email: z.string().min(3).max(320), password: z.string().min(1).max(256) })
  .strict();
const resetRequestBody = z.object({ email: z.string().min(3).max(320) }).strict();
const resetCompleteBody = z
  .object({
    store: z.string().min(1).max(64),
    token: z.string().min(1).max(256),
    password: z.string().min(8).max(256),
  })
  .strict();

const HOUR_MS = 60 * 60 * 1000;
const SIGNUP_IP_LIMIT = 5;
const SIGNUP_EMAIL_LIMIT = 3;
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const RESET_LIMIT = 5;

const INVALID_CREDENTIALS = {
  status: 401,
  body: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect" },
} as const;

/**
 * A verify against a hash nobody can match, so a missing or half-made account costs the same time as
 * a wrong password (same shape as `HashedPasswordAuthProvider`'s dummy verify).
 */
const hasher = new ScryptPasswordHasher();
let dummyHash: Promise<string> | undefined;
async function burnVerifyTime(password: string): Promise<void> {
  dummyHash ??= hasher.hash("morbeh-no-such-merchant-account");
  await hasher.verify(password, await dummyHash);
}

const normalise = (email: string): string => email.trim().toLowerCase();

/**
 * Project 1: the public merchant surface — self-serve sign-up, sign-in and password reset. These live
 * on the PLATFORM tenant only (a merchant has no store, so no tenant of their own, until sign-up
 * makes one); the store a sign-in or reset acts on comes from the staff directory, never the client.
 * NOT idempotent, for the same reason as the staff login: a replayed response would hand a second
 * caller the first caller's token.
 */
export function publicMerchantRoutes(
  admin: WiredAdmin,
  options: { readonly rateLimiter?: RateLimiter; readonly platformTenantId?: string } = {},
): readonly RouteDefinition[] {
  const { rateLimiter, platformTenantId } = options;

  /** 503 without a platform tenant (single mode), 403 on any other tenant, else `null`. */
  const gate = (context: RequestContext) => {
    if (platformTenantId === undefined || platformTenantId === "") {
      return {
        status: 503,
        body: { code: "SIGNUP_UNAVAILABLE", message: "Merchant sign-up is not available" },
      };
    }
    if (context.tenantId !== platformTenantId) {
      return {
        status: 403,
        body: { code: "FORBIDDEN", message: "Not available for this store" },
      };
    }
    return null;
  };

  /** `null` when allowed; the 429 response when the bucket is spent. */
  const limited = async (key: string, limit: number, windowMs: number, message: string) => {
    if (rateLimiter === undefined) return null;
    const decision = await rateLimiter.consume(key, limit, windowMs);
    return decision.allowed ? null : rateLimited(decision.retryAfterMs, message);
  };

  return [
    defineRoute({
      method: "POST",
      path: "/public/merchant-signup",
      version: 1,
      permission: "security:authenticate",
      public: true,
      summary: "Public: create a merchant store, its owner and trial, and sign the owner in",
      schema: { body: signupBody },
      handle: async ({ body, context }) => {
        const refused = gate(context);
        if (refused !== null) return refused;
        const byIp = await limited(
          `rl:signup-ip:${context.ip ?? "unknown"}`,
          SIGNUP_IP_LIMIT,
          HOUR_MS,
          "Too many sign-up attempts from this address",
        );
        if (byIp !== null) return byIp;
        const byEmail = await limited(
          `rl:signup-email:${normalise(body.email)}`,
          SIGNUP_EMAIL_LIMIT,
          HOUR_MS,
          "Too many sign-up attempts for this email",
        );
        if (byEmail !== null) return byEmail;

        const outcome = await admin.merchantOnboarding.signUp(body);
        switch (outcome.kind) {
          case "email-taken":
            return {
              status: 409,
              body: {
                code: "EMAIL_TAKEN",
                message: "An account with this email already exists",
              },
            };
          case "unavailable":
            // The reason (missing plan, incomplete provisioning) is for the logs, not the wire.
            return {
              status: 503,
              body: {
                code: "SIGNUP_UNAVAILABLE",
                message: "Sign-up is temporarily unavailable, please try again later",
              },
            };
          case "created": {
            const { tenantId, storeUrl, session } = outcome;
            if (session.status !== 200) {
              // The store exists but the automatic sign-in failed: no token, the client sends the
              // merchant to the login page.
              return { status: 201, body: { tenantId, storeUrl, signInRequired: true } };
            }
            const token = session.body as {
              readonly accessToken: string;
              readonly tokenType: string;
              readonly expiresIn: number;
            };
            return {
              status: 201,
              body: {
                tenantId,
                storeUrl,
                accessToken: token.accessToken,
                tokenType: token.tokenType,
                expiresIn: token.expiresIn,
              },
            };
          }
        }
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/auth/merchant/login",
      version: 1,
      permission: "security:authenticate",
      public: true,
      summary: "Public: sign a merchant in with the email they signed up with",
      schema: { body: loginBody },
      handle: async ({ body, context }) => {
        const refused = gate(context);
        if (refused !== null) return refused;
        const email = normalise(body.email);
        const spent = await limited(
          `rl:merchant-login:${email}`,
          LOGIN_LIMIT,
          LOGIN_WINDOW_MS,
          "Too many sign-in attempts for this email",
        );
        if (spent !== null) return spent;

        const store = await admin.findStoreForEmail(email);
        if (store === null || store.status === "pending") {
          // A half-made store looks exactly like an unknown email: same body, same work.
          await burnVerifyTime(body.password);
          return INVALID_CREDENTIALS;
        }
        const session = await admin.staffAuth.login({
          tenantId: store.shopId,
          email,
          password: body.password,
        });
        if (session.status === 200) return session;
        const error = (session.body as { error?: { code?: string } } | null)?.error;
        if (session.status === 403 && error?.code === "MFA_REQUIRED") return session;
        if (session.status === 503 || error?.code === "NOT_CONFIGURED") {
          // The client still gets the ordinary 401 (nothing about the deployment on the wire), but
          // every merchant sign-in is failing, so the operator has to hear about it.
          logger.error(
            "merchant login failed: native staff sign-in is not configured (AUTH_MODE=native, staff token issuer)",
            { tenantId: store.shopId },
          );
        }
        return INVALID_CREDENTIALS;
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/auth/merchant/password-reset/request",
      version: 1,
      permission: "security:authenticate",
      public: true,
      summary: "Public: email a merchant a single-use password-reset link (always 202)",
      schema: { body: resetRequestBody },
      handle: async ({ body, context }) => {
        const refused = gate(context);
        if (refused !== null) return refused;
        const email = normalise(body.email);
        const spent = await limited(
          `rl:merchant-reset:${email}`,
          RESET_LIMIT,
          HOUR_MS,
          "Too many reset requests for this email",
        );
        if (spent !== null) return spent;

        const store = await admin.findStoreForEmail(email);
        if (store !== null && store.status === "active") {
          await admin.staffAuth.requestPasswordReset({
            tenantId: store.shopId,
            email,
            storeId: store.shopId,
          });
        }
        return { status: 202, body: {} };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/auth/merchant/password-reset/complete",
      version: 1,
      permission: "security:authenticate",
      public: true,
      summary: "Public: set a new merchant password with a reset token",
      schema: { body: resetCompleteBody },
      handle: async ({ body, context }) => {
        const refused = gate(context);
        if (refused !== null) return refused;
        return admin.staffAuth.completePasswordReset({
          tenantId: body.store,
          token: body.token,
          password: body.password,
        });
      },
    }),
  ];
}
