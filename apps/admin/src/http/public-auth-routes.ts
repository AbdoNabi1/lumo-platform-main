import { z } from "zod";
import { defineRoute, type RequestContext, type RouteDefinition } from "@platform/http";
import type { Cart } from "@platform/cart";
import { NotFoundError, toErrorEnvelope } from "@platform/utils";
import type { WiredAdmin } from "../composition";

/**
 * The public **customer authentication** surface (T5.17, implementing T5.16 §1/§2). Mounted exactly
 * like every other `public/*-routes.ts` file — same Runtime Gateway, `public: true` so the pipeline
 * skips the admin authenticator and `AdminGuard` — and, like `public-cart-routes.ts` and
 * `public-reviews-routes.ts`, it reaches the domain through `admin.publicReads.*` rather than a
 * guarded `*AdminController`. That indirection is not a shortcut around authorization; it is what
 * avoids the anti-pattern `public-catalog-routes.ts`'s header comment names: calling a guarded
 * controller with a fabricated anonymous `Principal`, which silently allows everything under
 * `AllowAllAccessControl` and silently denies everything under Keto.
 *
 * The critical difference from every public route that came before it: those are genuinely
 * anonymous, whereas the routes below establish and then consume a REAL, server-validated identity.
 * `public: true` here means only "the *admin* Bearer/RBAC pipeline does not apply" — four of the six
 * routes run {@link CustomerGuard} themselves and fail closed with a 401. `/register` and `/login`
 * are the only genuinely unauthenticated ones, necessarily so: establishing the session is what they
 * are for.
 *
 * ── What never crosses this boundary ──
 * - **No `customerRef` is ever accepted.** Not in a body, not in a query string, not in a path
 *   param. Every route below that needs one derives it from the session (`requireSession`). This is
 *   the rule T5.16 §3 exists to enforce, and it is enforced structurally: no schema here has the
 *   field, so there is nothing for a handler to be tempted to read.
 * - **No password is ever logged or persisted here.** `password` reaches `Authenticate`/the Security
 *   password provider and stops. Note the deliberate asymmetry with `sessionRef` in
 *   `public-cart-routes.ts`: that value moved OUT of the query string into a header under H-05
 *   precisely because query strings land in request and proxy access logs. A credential must
 *   therefore never be a query param either — every route below that carries one is a POST with a
 *   body, and the session id travels in a header on reads for the same reason.
 * - **The session id is opaque.** It is Security's `Session.id` and nothing else — no JWT, no
 *   embedded claims, no `customerRef`. Opacity is what makes revocation immediate (see
 *   `CustomerGuard`'s doc comment).
 */

/**
 * The customer session id, read from the `x-customer-session` header — same transport decision, and
 * the same reason, as `x-cart-session` in `public-cart-routes.ts` (H-05: never in a URL, never in a
 * log). Absent/empty is not an error here: it is handed to {@link CustomerGuard}, which returns the
 * one shared 401 for it along with every other failure, so "no cookie" and "bad cookie" stay
 * indistinguishable to the caller.
 */
export function resolveCustomerSessionId(context: RequestContext): string | undefined {
  const header = context.headers?.["x-customer-session"];
  const value = Array.isArray(header) ? header[0] : header;
  return value !== undefined && value.length > 0 ? value : undefined;
}

const registerBody = z
  .object({
    email: z.string().min(3).max(320),
    name: z.string().min(1).max(200),
    /**
     * A floor, not a policy. Real password policy (composition, breach lists, rotation) belongs to
     * the configured authentication provider — the same place hashing and storage live — not to a
     * transport schema. `.max` is a denial-of-service bound on the hashing work, not a rule.
     */
    password: z.string().min(8).max(200),
  })
  .strict();

const loginBody = z
  .object({
    email: z.string().min(3).max(320),
    password: z.string().min(1).max(200),
    /** Optional device-trust signal; `Authenticate` registers/touches the device and scores risk with it. */
    deviceFingerprint: z.string().min(1).max(200).optional(),
  })
  .strict();

/**
 * `.strict()` on the empty object matters: it makes a body that tries to smuggle a `customerRef`,
 * `sessionId`, or `principalExternalId` fail zod validation (422) at the boundary rather than being
 * silently ignored. The session travels in the header; nothing else is accepted.
 */
const emptyBody = z.object({}).strict();

const claimCartBody = z
  .object({
    cartId: z.string().min(1),
    /** Proof of GUEST-cart ownership — the same `sessionRef` every other public cart route requires. */
    sessionRef: z.string().min(1),
  })
  .strict();

/** The identical envelope an unknown cart id returns — so a cart owned by another session is indistinguishable from one that does not exist. */
function cartNotFound(): { readonly status: number; readonly body: unknown } {
  return { status: 404, body: toErrorEnvelope(new NotFoundError("Cart not found")) };
}

export function publicAuthRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/public/auth/register",
      version: 1,
      // Advisory only — `public: true` means no guard runs (see `RouteDefinition.permission`).
      permission: "identity:register_customer",
      public: true,
      idempotent: true,
      summary: "Public: register a customer account (profile + security principal + credential)",
      schema: { body: registerBody },
      handle: ({ body, context }) =>
        admin.customerAuth.register({ ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/public/auth/login",
      version: 1,
      permission: "security:authenticate",
      public: true,
      /**
       * NOT `idempotent`. Every other public write route here is, but replaying a cached login
       * response would hand a second caller presenting the same `Idempotency-Key` the FIRST caller's
       * session id — the replay cache is keyed by that header, not by who sent it. A login must
       * always execute: it is the one write whose whole purpose is to mint a fresh credential-bearing
       * result, and `Authenticate` is already safe to call repeatedly (each attempt is risk-scored
       * and audited, which is exactly what should happen on a retry).
       */
      summary: "Public: authenticate a customer and establish a session",
      schema: { body: loginBody },
      handle: ({ body, context }) =>
        admin.customerAuth.login({
          tenantId: context.tenantId,
          email: body.email,
          password: body.password,
          ...(body.deviceFingerprint !== undefined
            ? { deviceFingerprint: body.deviceFingerprint }
            : {}),
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/public/auth/logout",
      version: 1,
      permission: "security:revoke_session",
      public: true,
      idempotent: true,
      summary: "Public: revoke the caller's own customer session (logout)",
      schema: { body: emptyBody },
      handle: ({ context }) =>
        admin.customerAuth.logout(resolveCustomerSessionId(context), context.tenantId),
    }),
    defineRoute({
      method: "POST",
      path: "/public/auth/refresh",
      version: 1,
      permission: "security:refresh_session",
      public: true,
      /**
       * NOT `idempotent`, for a different reason than `/login`: `Session.refresh` deliberately rejects
       * a reused refresh token, so serving a replayed response would report success for a rotation
       * that never happened and leave the session on its old, shorter window.
       */
      summary: "Public: slide the caller's own session window forward (rotates the refresh token)",
      schema: { body: emptyBody },
      handle: ({ context }) =>
        admin.customerAuth.refresh(resolveCustomerSessionId(context), context.tenantId),
    }),
    defineRoute({
      method: "POST",
      path: "/public/auth/logout-all",
      version: 1,
      permission: "security:revoke_all_sessions",
      public: true,
      idempotent: true,
      summary: "Public: revoke every session for the caller's own principal (sign out everywhere)",
      schema: { body: emptyBody },
      handle: ({ context }) =>
        admin.customerAuth.revokeAllSessions(resolveCustomerSessionId(context), context.tenantId),
    }),
    defineRoute({
      method: "GET",
      path: "/public/auth/me",
      version: 1,
      permission: "identity:read_customer",
      public: true,
      summary: "Public: the signed-in customer's own profile (401 when there is no valid session)",
      schema: {},
      handle: ({ context }) =>
        admin.customerAuth.me(resolveCustomerSessionId(context), context.tenantId),
    }),
    defineRoute({
      method: "POST",
      path: "/public/auth/claim-cart",
      version: 1,
      permission: "cart:assign_customer",
      public: true,
      idempotent: true,
      summary: "Public: promote the caller's guest cart to their signed-in account (login merge)",
      schema: { body: claimCartBody },
      /**
       * Login-time cart continuity (T5.16 §2). TWO independent ownership proofs are required and
       * neither substitutes for the other: the customer session proves *who* is claiming (and is the
       * only source of the `customerRef`), while `sessionRef` proves the caller actually owns the
       * guest cart being claimed. Without the second, a signed-in customer could absorb any cart
       * whose id they guessed; without the first, anyone could attach a cart to any account. Cart
       * ownership is checked here, in the route, exactly as `requireOwnedCart` does it in
       * `public-cart-routes.ts` — a cart owned by another session returns the same 404 an unknown
       * cart id does, never a 403 that would confirm the cart exists.
       */
      handle: async ({ body, context }) => {
        const guarded = await admin.customerAuth.requireSession(
          resolveCustomerSessionId(context),
          context.tenantId,
        );
        if (!guarded.ok) return guarded.response;

        const found = await admin.publicReads.cart.get({
          tenantId: context.tenantId,
          cartId: body.cartId,
        });
        if (found.status < 200 || found.status >= 300) return cartNotFound();
        const cart = found.body as Cart;
        if (cart.sessionRef !== body.sessionRef) return cartNotFound();

        return admin.publicReads.cart.assignCustomer({
          tenantId: context.tenantId,
          cartId: body.cartId,
          customerRef: guarded.session.customerRef,
        });
      },
    }),
  ] as readonly RouteDefinition[];
}
