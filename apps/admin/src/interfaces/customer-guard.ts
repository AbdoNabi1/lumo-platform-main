import type { CustomerController } from "@platform/identity";
import type { SecurityController, SessionSubject } from "@platform/security";
import { AuthenticationError, toErrorEnvelope } from "@platform/utils";
import type { AdminResponse } from "./admin-response";

export interface CustomerGuardDeps {
  readonly security: SecurityController;
  readonly customers: CustomerController;
}

/** The validated identity behind a customer session — the ONLY source of a `customerRef` on a public route. */
export interface CustomerSession {
  /** The opaque Security session id the caller presented (echoed for logging/refresh, never derived). */
  readonly sessionId: string;
  /** Identity's `Customer.id` — what Wishlist/Loyalty/Orders/Reviews key their per-customer data by. */
  readonly customerRef: string;
  /** Security's `Principal.externalId` — what `RevokeAllSessions` keys "sign out everywhere" by. */
  readonly principalExternalId: string;
  readonly expiresAt: string;
}

export type CustomerGuardResult =
  | { readonly ok: true; readonly session: CustomerSession }
  | { readonly ok: false; readonly response: AdminResponse };

/**
 * The **storefront boundary's authentication point** (T5.17, designed by T5.16 §1) — a deliberately
 * much lighter sibling of {@link AdminGuard}, and NOT a variant of it.
 *
 * `AdminGuard` answers "may this principal perform this permission?" — an ABAC/RBAC decision against
 * a permission grid, audited on every call. A customer request has no such question to ask: there is
 * exactly one thing to authorize, "is this the session's own `customerRef`", and a handler enforces
 * that *structurally* by only ever using the `customerRef` this guard derives and never accepting one
 * from the caller. So this guard takes no `Permission`, consults no `AccessControl`, and writes no
 * per-request authorization audit record. Routing a shopper through `AdminGuard` instead would mean
 * fabricating a `Principal` for them, which — per `public-catalog-routes.ts`'s own header comment —
 * either silently allows everything (`AllowAllAccessControl`) or silently denies everything (Keto, in
 * which no policy grants a "public" principal anything). Both are wrong; neither is "authenticated".
 *
 * What it does instead is resolve, entirely server-side, on every single request:
 *
 *   opaque session id (HttpOnly cookie) → Security `Session` → `Principal` → Identity `Customer`
 *
 * The first two hops are `IntrospectSessionSubject` (`services/security`); the third is Identity's
 * own `GetCustomer`. That third hop is not ceremony: a `Principal.subjectRef` is only a *reference*
 * to an Identity subject (Security stores no human PII and never learns that a customer was deleted),
 * so without it a session could keep resolving to a `customerRef` whose `Customer` no longer exists.
 *
 * **Fail closed and uniformly.** Every failure — no cookie, unknown/expired/revoked session, a
 * suspended principal, a non-human principal, a missing customer — produces the identical 401 below.
 * A caller can never tell which of those it hit, so this is not an oracle for probing session ids or
 * customer existence. Note what is deliberately NOT here: no 404 branch, and no "empty result" branch.
 * Per T5.16 §3, an unauthenticated caller must get a 401, never an empty list — an empty list asserts
 * "you have zero of these", which is a different and, for an anonymous caller, false statement.
 *
 * Session **revocation is immediate** because the cookie is only a lookup key: `RevokeSession`/
 * `RevokeAllSessions` land on the next request through the introspection hop. A self-contained signed
 * token would keep validating locally until its own expiry regardless.
 */
export class CustomerGuard {
  private readonly deps: CustomerGuardDeps;

  constructor(deps: CustomerGuardDeps) {
    this.deps = deps;
  }

  /**
   * The single 401 every failure path returns. One shared envelope, built once, so no caller can
   * distinguish "no session" from "expired session" from "no such customer" by response shape,
   * message, or status.
   */
  static unauthenticated(): AdminResponse {
    return {
      status: 401,
      body: toErrorEnvelope(new AuthenticationError("A valid customer session is required")),
    };
  }

  /**
   * Resolves the caller's session to a validated {@link CustomerSession}, or the shared 401.
   * `sessionId` comes from the storefront's HttpOnly cookie, forwarded server-to-server — never from
   * browser JavaScript, and never from a request body or query string a page could be tricked into
   * composing.
   */
  async resolve(sessionId: string | undefined, tenantId: string): Promise<CustomerGuardResult> {
    if (sessionId === undefined || sessionId.trim().length === 0) {
      return { ok: false, response: CustomerGuard.unauthenticated() };
    }

    const introspected = await this.deps.security.introspectSessionSubject({ tenantId, sessionId });
    if (introspected.status < 200 || introspected.status >= 300) {
      return { ok: false, response: CustomerGuard.unauthenticated() };
    }
    const subject = introspected.body as SessionSubject;
    if (
      !subject.active ||
      subject.subjectRef === null ||
      subject.sessionId === null ||
      subject.principalExternalId === null ||
      subject.expiresAt === null
    ) {
      return { ok: false, response: CustomerGuard.unauthenticated() };
    }

    // Third hop — the Principal's `subjectRef` is only a reference; confirm the Customer it points at
    // still exists in Identity before letting any route scope data by it.
    const customer = await this.deps.customers.getCustomer({
      customerId: subject.subjectRef,
      tenantId,
    });
    if (customer.status < 200 || customer.status >= 300) {
      return { ok: false, response: CustomerGuard.unauthenticated() };
    }

    return {
      ok: true,
      session: {
        sessionId: subject.sessionId,
        customerRef: subject.subjectRef,
        principalExternalId: subject.principalExternalId,
        expiresAt: subject.expiresAt,
      },
    };
  }
}
