import type { IdGenerator } from "@platform/contracts";
import type { Customer, CustomerController } from "@platform/identity";
import type { SecurityController, SessionSubject } from "@platform/security";
import type { AdminResponse } from "./admin-response";
import { CustomerGuard, type CustomerSession } from "./customer-guard";
import type { CustomerCredentialsPort } from "./customer-credentials.port";

/** The session a successful login/refresh hands back. Carries an OPAQUE session id and nothing else identifying. */
export interface CustomerSessionDto {
  readonly sessionId: string;
  readonly customerRef: string;
  readonly expiresAt: string;
}

/** The customer's own profile — the minimum an account page needs, no more. */
export interface CustomerProfileDto {
  readonly customerRef: string;
  readonly email: string;
  readonly name: string;
}

export interface CustomerAuthAdminControllerDeps {
  readonly security: SecurityController;
  readonly customers: CustomerController;
  readonly credentials: CustomerCredentialsPort;
  readonly guard: CustomerGuard;
  readonly idGenerator: IdGenerator;
  /** Sliding session lifetime, seconds. See `CUSTOMER_SESSION_TTL_SECONDS` in `composition.ts`. */
  readonly sessionTtlSeconds: number;
}

/**
 * The **customer-facing authentication surface** (T5.17, designed by T5.16 §1) — a thin orchestrator
 * over Security's existing `Authenticate` / `RefreshSession` / `RevokeSession` / `RevokeAllSessions`
 * use cases and Identity's `RegisterCustomer`. Parallel in shape to
 * {@link SecuritySessionsAdminController}, but with the guard inverted: that controller runs
 * `AdminGuard.ensure(principal, permission)` before every call, because it exposes the operator
 * console's session tooling. Here there is no acting principal to authorize — establishing one is
 * the whole point of the flow — so `login`/`register` are unguarded by construction and only the
 * post-login actions (`logout`/`refresh`/`revokeAll`/`me`) run {@link CustomerGuard}.
 *
 * **No second auth stack.** Nothing here verifies a credential, scores risk, decides MFA, mints a
 * session, or stores a password. Every one of those is `Authenticate`'s job and stays there; this
 * class only translates between the public HTTP shape and Security's inputs, and converts Security's
 * outcomes into responses that leak nothing.
 *
 * ── Three rules this surface owns ──
 * 1. **A failed login is one indistinguishable answer.** `AuthenticationOutcome.reason` distinguishes
 *    "no such account" from "invalid credentials"; forwarding it would turn this route into an
 *    account-enumeration oracle. {@link failedLogin} is returned verbatim for every failure.
 * 2. **`customerRef` is never echoed from input and never accepted as input.** On login it is read
 *    back out of the freshly established session via the same `IntrospectSessionSubject` round trip
 *    every subsequent request uses — so a login response can only report an identity the session
 *    mechanism itself will agree with on the next request. Nothing here is fabricated or assumed.
 * 3. **Registration provisions the `Principal` synchronously.** See {@link register}.
 */
export class CustomerAuthAdminController {
  private readonly deps: CustomerAuthAdminControllerDeps;
  /** Memoizes {@link ensurePasswordMethod} so the registry is consulted at most once per process. */
  private passwordMethodReady: Promise<void> | null = null;

  constructor(deps: CustomerAuthAdminControllerDeps) {
    this.deps = deps;
  }

  /**
   * Ensures the `"password"` authentication method exists in Security's versioned Registry Engine
   * before the first login or registration. `Authenticate` refuses outright when the method is
   * absent or disabled ("Authentication method \"password\" is not enabled"), and nothing in this
   * repo's boot path registers one today — the admin console registers auth methods on demand
   * through `POST /security/auth-methods`, which a storefront deployment may never call.
   *
   * **This is the one config decision T5.16 §1 explicitly left to the implementer**: whether the
   * customer surface gets its own `AuthMethodKind` (e.g. `"customer_password"`) so customer password
   * policy can be configured separately from staff auth. The smallest reasonable call is taken here —
   * reuse the existing `"password"` kind, because it is already a member of the frozen
   * `AuthMethodKind` union (adding a new one is a `packages/registry`/domain change this task is not
   * scoped to make) and because `InMemoryPasswordAuthProvider` is registered against exactly that
   * kind. A deployment that wants them split registers its own method at boot and points a distinct
   * provider at it; nothing above this method changes.
   *
   * It **never overwrites an existing registration**: re-registering the same key would mint a new
   * registry version and could replace a `displayName`/`config`/`enabled` an operator deliberately
   * set through the admin console. The registry is read first, and only a genuinely absent entry is
   * created. A method an operator has explicitly *disabled* is left disabled — login then fails, which
   * is the correct outcome for "password login is turned off", not something to silently re-enable.
   */
  private async ensurePasswordMethod(): Promise<void> {
    this.passwordMethodReady ??= (async () => {
      const registries = this.deps.security.registryExplorer().registries;
      const authMethods = registries.find((registry) => registry.name === "auth-methods");
      const alreadyRegistered =
        authMethods?.entries.some((entry) => entry.key === "password") ?? false;
      if (alreadyRegistered) return;
      await this.deps.security.registerAuthMethod({
        kind: "password",
        displayName: "Password",
      });
    })();
    return this.passwordMethodReady;
  }

  /** The single response every authentication failure returns — see rule 1 in the class doc comment. */
  private static failedLogin(): AdminResponse {
    return CustomerGuard.unauthenticated();
  }

  /**
   * Registers a customer AND provisions everything they need to log in, in one call:
   *
   *   1. Identity `RegisterCustomer` — the profile record, and the uniqueness authority for the email.
   *   2. `registerSubject` — makes the new customer id visible to Security's identity directory.
   *   3. Security `RegisterPrincipal` (`kind: "human"`, `subjectRef: customerId`) — the missing link
   *      T5.16 §1 identified between Identity's `Customer` and Security's session/credential stack.
   *   4. `setPassword` — the credential, stored only through Security's own password provider.
   *
   * **Why here and not inside `Customer.register()`** (T5.16 offered either): the brief asks for
   * whichever option is less invasive to Identity's registration flow, and this one changes
   * `services/identity` by exactly zero lines. Identity keeps owning the customer profile and stays
   * unaware that Security exists, which is the ownership boundary ADR-0023 already froze; a
   * `CustomerRegistrationPort` inside `RegisterCustomer` would have inverted it, making every
   * customer registration anywhere — including the admin console's — depend on Security being wired.
   * Cross-context orchestration for one public transport belongs at that transport's boundary, which
   * is this class. The alternative T5.16 also floated, provisioning lazily on first authentication,
   * does not work at all: `Authenticate` resolves the principal *during* login and fails closed when
   * there is none, so the principal must already exist before the first login attempt, not after it.
   *
   * Step 1 is the transactional one and the uniqueness gate; 2-4 are additive provisioning that
   * cannot fail for a customer id that was just minted. A failure in step 3 is surfaced as-is rather
   * than swallowed — a customer with no principal could never log in, and silently returning 201 for
   * an account that cannot be used is worse than a visible error.
   */
  async register(input: {
    readonly email: string;
    readonly name: string;
    readonly password: string;
    readonly tenantId: string;
  }): Promise<AdminResponse> {
    const registered = await this.deps.customers.register({
      email: input.email,
      name: input.name,
      tenantId: input.tenantId,
    });
    // 409 (email already registered), 422 (invalid email/name) — the owning context's presenter
    // already mapped it; the admin layer never re-maps a status (see `AdminResponse`'s doc comment).
    if (registered.status < 200 || registered.status >= 300) return registered;

    const { customerId } = registered.body as { customerId: string };

    await this.deps.credentials.registerSubject(customerId);
    const principal = await this.deps.security.registerPrincipal({
      externalId: customerId,
      kind: "human",
      displayName: customerId,
      subjectRef: customerId,
    });
    if (principal.status < 200 || principal.status >= 300) return principal;

    await this.ensurePasswordMethod();
    await this.deps.credentials.setPassword(input.email, input.password, customerId);

    return { status: 201, body: { customerRef: customerId } };
  }

  /**
   * Authenticates and establishes a session. Delegates the entire decision — credential verification
   * via the registered provider plugin, risk scoring, MFA decisioning, device trust, and session
   * establishment — to Security's `Authenticate`, then reads the resulting identity back through
   * `IntrospectSessionSubject` (rule 2 above).
   *
   * `sessionTtlSeconds` is passed on every login: the customer session is a short sliding window
   * (T5.16 §2), not the hour `Authenticate` would otherwise default to or the cart cookie's 30 days.
   */
  async login(input: {
    readonly email: string;
    readonly password: string;
    readonly deviceFingerprint?: string;
    readonly ip?: string;
  }): Promise<AdminResponse> {
    await this.ensurePasswordMethod();
    const outcome = await this.deps.security.authenticate({
      method: "password",
      identifier: input.email,
      credential: input.password,
      ...(input.deviceFingerprint !== undefined
        ? { deviceFingerprint: input.deviceFingerprint }
        : {}),
      ...(input.ip !== undefined ? { ip: input.ip } : {}),
      sessionTtlSeconds: this.deps.sessionTtlSeconds,
    });
    if (outcome.status < 200 || outcome.status >= 300)
      return CustomerAuthAdminController.failedLogin();

    const result = outcome.body as {
      readonly authenticated: boolean;
      readonly sessionId: string | null;
      readonly mfaRequirement: string;
    };
    // `authenticated: true` with no session means the MFA Engine required a factor this flow has not
    // satisfied. It is NOT a login — there is no session to hand back — but it is also not a bad
    // credential, and telling the two apart is safe here (the caller already proved the password).
    if (result.authenticated && result.sessionId === null) {
      return {
        status: 403,
        body: {
          error: {
            code: "MFA_REQUIRED",
            message: "An additional authentication factor is required",
          },
          mfaRequirement: result.mfaRequirement,
        },
      };
    }
    if (!result.authenticated || result.sessionId === null) {
      return CustomerAuthAdminController.failedLogin();
    }

    return this.presentSession(result.sessionId);
  }

  /**
   * Logout — `RevokeSession` on the caller's own session id. Revoking is scoped by the guard, so a
   * caller can only ever revoke the session they actually hold: a session id belonging to someone
   * else fails the guard and returns the shared 401, never a revocation.
   *
   * An already-invalid session is reported honestly as `{revoked: false}` with a 200 rather than a
   * 401: the storefront's only reasonable response to either is "clear the cookie", and a session
   * that no longer exists *is* logged out. `revoked` says which actually happened — nothing is
   * fabricated to make the flow look tidier.
   */
  async logout(sessionId: string | undefined, tenantId: string): Promise<AdminResponse> {
    const guarded = await this.deps.guard.resolve(sessionId, tenantId);
    if (!guarded.ok) return { status: 200, body: { revoked: false } };

    const revoked = await this.deps.security.revokeSession({
      sessionId: guarded.session.sessionId,
    });
    if (revoked.status < 200 || revoked.status >= 300) return revoked;
    return { status: 200, body: { revoked: true } };
  }

  /**
   * Sliding-window refresh — `RefreshSession` rotates the refresh fingerprint and extends the TTL
   * ("refresh must rotate the token, reuse rejected" is `Session.refresh`'s own guard). The rotated
   * fingerprint is generated server-side here and never leaves the server: the storefront holds only
   * the session id, which is unchanged by a refresh, so a refresh never requires re-issuing a cookie
   * value — only its expiry moves.
   */
  async refresh(sessionId: string | undefined, tenantId: string): Promise<AdminResponse> {
    const guarded = await this.deps.guard.resolve(sessionId, tenantId);
    if (!guarded.ok) return guarded.response;

    const refreshed = await this.deps.security.refreshSession({
      sessionId: guarded.session.sessionId,
      newRefreshFingerprint: this.deps.idGenerator.generate(),
      ttlSeconds: this.deps.sessionTtlSeconds,
    });
    if (refreshed.status < 200 || refreshed.status >= 300) return refreshed;

    return this.presentSession(guarded.session.sessionId);
  }

  /**
   * "Sign out of every device" — `RevokeAllSessions`, keyed by the principal external id the guard
   * resolved, never by one the caller supplied. Already built and already proven on the admin console
   * (`RevokeAllSessionsForm`); no new use case was needed, exactly as T5.16 §2 predicted.
   */
  async revokeAllSessions(sessionId: string | undefined, tenantId: string): Promise<AdminResponse> {
    const guarded = await this.deps.guard.resolve(sessionId, tenantId);
    if (!guarded.ok) return guarded.response;

    return this.deps.security.revokeAllSessions({
      principalExternalId: guarded.session.principalExternalId,
    });
  }

  /** The signed-in customer's own profile. `customerRef` comes from the guard, never from the caller. */
  async me(sessionId: string | undefined, tenantId: string): Promise<AdminResponse> {
    const guarded = await this.deps.guard.resolve(sessionId, tenantId);
    if (!guarded.ok) return guarded.response;

    const response = await this.deps.customers.getCustomer({
      customerId: guarded.session.customerRef,
      tenantId,
    });
    if (response.status < 200 || response.status >= 300) return response;

    // `Customer` is a domain aggregate — projected to primitives before it can reach the wire.
    const customer = response.body as Customer;
    const profile: CustomerProfileDto = {
      customerRef: guarded.session.customerRef,
      email: customer.email.value,
      name: customer.name,
    };
    return { status: 200, body: profile };
  }

  /**
   * Projects an established session into {@link CustomerSessionDto} by resolving it through the SAME
   * `IntrospectSessionSubject` hop every guarded request uses. A session that cannot be resolved back
   * immediately after being established is a genuine inconsistency, not a login — it fails closed.
   */
  private async presentSession(sessionId: string): Promise<AdminResponse> {
    const introspected = await this.deps.security.introspectSessionSubject({ sessionId });
    if (introspected.status < 200 || introspected.status >= 300) {
      return CustomerAuthAdminController.failedLogin();
    }
    const subject = introspected.body as SessionSubject;
    if (!subject.active || subject.subjectRef === null || subject.expiresAt === null) {
      return CustomerAuthAdminController.failedLogin();
    }
    const dto: CustomerSessionDto = {
      sessionId,
      customerRef: subject.subjectRef,
      expiresAt: subject.expiresAt,
    };
    return { status: 200, body: dto };
  }

  /**
   * The reusable seam for every OTHER customer-scoped route (Wishlist here, Loyalty in T5.19, review
   * authoring in T5.18-write): resolve the session, get a validated `customerRef`, or get the shared
   * 401. Exposed on this controller rather than making each route reach for `CustomerGuard` directly
   * so there is exactly one place customer authentication enters the HTTP layer.
   */
  async requireSession(
    sessionId: string | undefined,
    tenantId: string,
  ): Promise<
    | { readonly ok: true; readonly session: CustomerSession }
    | { readonly ok: false; readonly response: AdminResponse }
  > {
    return this.deps.guard.resolve(sessionId, tenantId);
  }
}
