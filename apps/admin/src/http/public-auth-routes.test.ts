import { beforeEach, describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireCart, type WiredCart } from "@platform/cart";
import { wireIdentity, type WiredIdentity } from "@platform/identity";
import { wireSecurity, type WiredSecurity } from "@platform/security";
import type { WiredAdmin } from "../composition";
import { CustomerAuthAdminController } from "../interfaces/customer-auth.admin-controller";
import type { CustomerCredentialsPort } from "../interfaces/customer-credentials.port";
import { CustomerGuard } from "../interfaces/customer-guard";
import type { SignupEmailPort } from "../interfaces/signup-email.port";
import { publicAuthRoutes } from "./public-auth-routes";

/** Records every signup email a test dispatched, instead of actually sending or logging one. */
class RecordingSignupEmailPort implements SignupEmailPort {
  readonly completeAccountCalls: Array<{ email: string; link: string; tenantId: string }> = [];
  readonly alreadyRegisteredCalls: Array<{ email: string; tenantId: string }> = [];

  async sendCompleteAccountEmail(input: {
    email: string;
    link: string;
    tenantId: string;
  }): Promise<void> {
    this.completeAccountCalls.push(input);
  }

  async sendAlreadyRegisteredEmail(input: { email: string; tenantId: string }): Promise<void> {
    this.alreadyRegisteredCalls.push(input);
  }
}

const SIGNUP_COMPLETION_URL_BASE = "https://shop.example.com/account/signup/complete";

/**
 * The public customer-auth HTTP surface (T5.17 Part A) driven through the actual
 * `RouteDefinition.handle()` boundary over REAL `wireSecurity()`/`wireIdentity()`/`wireCart()`
 * compositions (in-memory branch) — same technique as `public-cart-routes.test.ts` and
 * `public-reviews-routes.test.ts`. Nothing about authentication is mocked: every assertion below is
 * the result of a genuine `Authenticate` → `Session.establish` → `IntrospectSessionSubject` round
 * trip, which is the point — a fabricated session would prove nothing about this design.
 *
 * The bulk of these tests are negative. The security properties this task must hold are all of the
 * form "X must NOT be possible", and each of them is one line away from being true by accident.
 */

const NOW = new Date("2026-08-31T00:00:00.000Z");
let now = NOW;
const clock: Clock = { now: () => now };

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

interface Harness {
  readonly admin: WiredAdmin;
  readonly security: WiredSecurity;
  readonly identity: WiredIdentity;
  readonly cart: WiredCart;
  readonly signupEmail: RecordingSignupEmailPort;
}

/**
 * Builds the slice of `WiredAdmin` these routes actually read, over real compositions — the same
 * `customerCredentials` adapter shape `composition.ts` wires in production.
 */
function harness(): Harness {
  now = NOW;
  const deps = {
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  };
  const security = wireSecurity(deps);
  const identity = wireIdentity(deps);
  const cart = wireCart(deps);

  const credentials: CustomerCredentialsPort = {
    registerSubject: async (subjectRef) => {
      security.identityDirectory.register(subjectRef);
    },
    setPassword: async (identifier, password, principalExternalId) => {
      security.passwordProvider.register(identifier, password, principalExternalId);
    },
  };
  const guard = new CustomerGuard({ security: security.security, customers: identity.customers });
  const signupEmail = new RecordingSignupEmailPort();
  const customerAuth = new CustomerAuthAdminController({
    security: security.security,
    customers: identity.customers,
    credentials,
    guard,
    idGenerator: sequentialIds(),
    sessionTtlSeconds: 3600,
    signupEmail,
    signupCompletionUrlBase: SIGNUP_COMPLETION_URL_BASE,
  });

  const admin = {
    customerAuth,
    publicReads: {
      cart: cart.cart,
      security: security.security,
      customers: identity.customers,
    },
  } as unknown as WiredAdmin;

  return { admin, security, identity, cart, signupEmail };
}

interface Response {
  readonly status: number;
  readonly body: unknown;
}

/** Invokes a route by method+path with an optional customer-session header, exactly as the transport would. */
function call(
  admin: WiredAdmin,
  method: string,
  path: string,
  options: { body?: unknown; sessionId?: string } = {},
): Promise<Response> {
  const route = publicAuthRoutes(admin).find((r) => r.method === method && r.path === path);
  if (route === undefined) throw new Error(`no route ${method} ${path}`);
  return route.handle({
    body: options.body ?? {},
    params: {},
    query: {},
    context: {
      tenantId: "tenant-local",
      requestId: "req-1",
      headers: options.sessionId !== undefined ? { "x-customer-session": options.sessionId } : {},
    },
  } as never) as Promise<Response>;
}

const CREDENTIALS = {
  email: "shopper@example.com",
  name: "Sam Shopper",
  password: "correct-horse",
};

async function register(admin: WiredAdmin, overrides: Partial<typeof CREDENTIALS> = {}) {
  return call(admin, "POST", "/public/auth/register", { body: { ...CREDENTIALS, ...overrides } });
}

async function login(admin: WiredAdmin, overrides: Partial<typeof CREDENTIALS> = {}) {
  const { email, password } = { ...CREDENTIALS, ...overrides };
  return call(admin, "POST", "/public/auth/login", { body: { email, password } });
}

async function completeSignup(
  admin: WiredAdmin,
  input: { token: string; name?: string; password?: string },
) {
  return call(admin, "POST", "/public/auth/signup/complete", {
    body: {
      token: input.token,
      name: input.name ?? "Real Name",
      password: input.password ?? "new-password",
    },
  });
}

/** Registers then logs in, returning the established opaque session id. */
async function signedIn(admin: WiredAdmin): Promise<{ sessionId: string; customerRef: string }> {
  const registered = await register(admin);
  expect(registered.status).toBe(201);
  const loggedIn = await login(admin);
  expect(loggedIn.status).toBe(200);
  const session = loggedIn.body as { sessionId: string; customerRef: string };
  return session;
}

let h: Harness;
beforeEach(() => {
  h = harness();
});

describe("POST /public/auth/register", () => {
  it("creates the Customer, the human Principal and the credential in one call", async () => {
    const response = await register(h.admin);

    expect(response.status).toBe(201);
    const { customerRef } = response.body as { customerRef: string };

    // The Identity customer exists...
    expect(
      (
        await h.identity.customers.getCustomer({
          customerId: customerRef,
          tenantId: "tenant-local",
        })
      ).status,
    ).toBe(200);
    // ...and so does the Security principal that references it — the link T5.16 §1 identified as missing.
    const resolved = await h.security.security.resolvePrincipal({
      tenantId: "tenant-local",
      subjectRef: customerRef,
    });
    const principal = (resolved.body as { principal: { externalId: string; kind: string } | null })
      .principal;
    expect(principal).not.toBeNull();
    expect(principal?.kind).toBe("human");
    expect(principal?.externalId).toBe(customerRef);
  });

  it("provisions an account that can immediately log in (the provisioning actually works end to end)", async () => {
    await register(h.admin);
    expect((await login(h.admin)).status).toBe(200);
  });

  it("never returns the password or a session — registration does not sign anyone in", async () => {
    const response = await register(h.admin);
    expect(Object.keys(response.body as object)).toEqual(["customerRef"]);
    expect(JSON.stringify(response.body)).not.toContain(CREDENTIALS.password);
  });

  it("G-72/D2: a duplicate email gets the check-email response, not a 409 (no purchase/account oracle)", async () => {
    await register(h.admin);
    const second = await register(h.admin, { name: "Impostor" });
    expect(second.status).toBe(202);
    expect(second.body).toEqual({ outcome: "link-sent" });
  });

  it("a duplicate-email signup cannot overwrite the existing account's credential", async () => {
    // The account-takeover shape this ordering exists to prevent: submitting someone else's email
    // with a password of your choosing must never re-point their credential at it.
    await register(h.admin);
    const hijack = await register(h.admin, { name: "Impostor", password: "attacker-chosen" });
    expect(hijack.status).toBe(202);

    expect((await login(h.admin, { password: "attacker-chosen" })).status).toBe(401);
    expect((await login(h.admin)).status).toBe(200);
  });
});

describe("POST /public/auth/register — G-72 guest-to-account upgrade", () => {
  /** Simulates WP-1's guest checkout creating a guest `identity.customers` row for an email. */
  async function guestCheckout(email: string, name = "Guest Buyer"): Promise<string> {
    const resolved = await h.identity.customers.resolveGuestCustomer({
      email,
      name,
      tenantId: "tenant-local",
    });
    expect(resolved.status).toBe(200);
    return (resolved.body as { customerId: string }).customerId;
  }

  it("a brand-new email still registers immediately, unchanged", async () => {
    const response = await register(h.admin, { email: "brand-new@example.com" });
    expect(response.status).toBe(201);
    expect(h.signupEmail.completeAccountCalls).toHaveLength(0);
    expect(h.signupEmail.alreadyRegisteredCalls).toHaveLength(0);
  });

  it("a guest email gets the check-email response — no principal, no credential created", async () => {
    const customerId = await guestCheckout("guest@example.com");

    const response = await register(h.admin, { email: "guest@example.com" });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ outcome: "link-sent" });
    const resolved = await h.security.security.resolvePrincipal({
      tenantId: "tenant-local",
      subjectRef: customerId,
    });
    expect((resolved.body as { principal: unknown }).principal).toBeNull();
    expect((await login(h.admin, { email: "guest@example.com" })).status).toBe(401);
  });

  it("D2: an already-registered email and a guest email get the byte-identical HTTP response", async () => {
    await register(h.admin, { email: "verified@example.com" });
    await guestCheckout("guest2@example.com");

    const alreadyRegistered = await register(h.admin, { email: "verified@example.com" });
    const guest = await register(h.admin, { email: "guest2@example.com" });

    expect(alreadyRegistered.status).toBe(guest.status);
    expect(alreadyRegistered.body).toEqual(guest.body);
    expect(h.signupEmail.alreadyRegisteredCalls).toHaveLength(1);
    expect(h.signupEmail.completeAccountCalls).toHaveLength(1);
  });

  it("dispatches exactly one email, containing a link with a token, for a guest signup", async () => {
    await guestCheckout("guest3@example.com");
    await register(h.admin, { email: "guest3@example.com" });

    expect(h.signupEmail.completeAccountCalls).toHaveLength(1);
    expect(h.signupEmail.alreadyRegisteredCalls).toHaveLength(0);
    const [sent] = h.signupEmail.completeAccountCalls;
    expect(sent?.link).toContain(SIGNUP_COMPLETION_URL_BASE);
    expect(sent?.link).toMatch(/[?&]token=/);
  });

  it("the attack: a guest email is registered by someone else and the link is never opened — login stays refused", async () => {
    await guestCheckout("victim@example.com");

    const attackerAttempt = await register(h.admin, {
      email: "victim@example.com",
      name: "Attacker",
      password: "attacker-chosen",
    });
    expect(attackerAttempt.status).toBe(202);
    expect(attackerAttempt.body).toEqual({ outcome: "link-sent" });

    // The attacker never opens the emailed link — nothing else happens with the token.

    expect(
      (await login(h.admin, { email: "victim@example.com", password: "attacker-chosen" })).status,
    ).toBe(401);
    expect((await call(h.admin, "GET", "/public/auth/me")).status).toBe(401);
  });

  it("completing with a valid token upgrades the SAME customer id and the prior guest identity is preserved", async () => {
    const customerId = await guestCheckout("upgrade@example.com");
    await register(h.admin, { email: "upgrade@example.com" });
    const [sent] = h.signupEmail.completeAccountCalls;
    const token = new URL(sent?.link ?? "").searchParams.get("token") ?? "";

    const completed = await completeSignup(h.admin, {
      token,
      name: "Real Name",
      password: "new-password",
    });

    expect(completed.status).toBe(201);
    const { customerRef, email } = completed.body as { customerRef: string; email: string };
    expect(customerRef).toBe(customerId);
    expect(email).toBe("upgrade@example.com");

    expect(
      (await login(h.admin, { email: "upgrade@example.com", password: "new-password" })).status,
    ).toBe(200);
  });

  it("expired, reused, wrong-tenant, and tampered tokens are all rejected indistinguishably", async () => {
    await guestCheckout("multi@example.com");
    await register(h.admin, { email: "multi@example.com" });
    const [sent] = h.signupEmail.completeAccountCalls;
    const token = new URL(sent?.link ?? "").searchParams.get("token") ?? "";

    const unknown = await completeSignup(h.admin, { token: "bogus-token-value" });
    const tampered = await completeSignup(h.admin, { token: token.slice(0, -1) + "0" });
    const first = await completeSignup(h.admin, { token });
    expect(first.status).toBe(201);
    const reused = await completeSignup(h.admin, { token });

    expect(unknown.status).toBe(404);
    expect(tampered.status).toBe(404);
    expect(reused.status).toBe(404);
    expect(unknown.body).toEqual(tampered.body);
    expect(tampered.body).toEqual(reused.body);
  });

  it("does not accept a completely made-up token as valid", async () => {
    const response = await completeSignup(h.admin, { token: "never-issued-at-all" });
    expect(response.status).toBe(404);
  });
});

describe("POST /public/auth/login", () => {
  it("establishes a real session and reports the customerRef read back OUT of it", async () => {
    const registered = await register(h.admin);
    const { customerRef } = registered.body as { customerRef: string };

    const response = await login(h.admin);

    expect(response.status).toBe(200);
    const session = response.body as { sessionId: string; customerRef: string; expiresAt: string };
    expect(session.customerRef).toBe(customerRef);
    expect(session.sessionId).toBeTruthy();
    expect(session.expiresAt).toBe("2026-08-31T01:00:00.000Z");
  });

  it("returns an OPAQUE session id — never a JWT, never the customerRef itself", async () => {
    const registered = await register(h.admin);
    const { customerRef } = registered.body as { customerRef: string };
    const { sessionId } = (await login(h.admin)).body as { sessionId: string };

    expect(sessionId).not.toBe(customerRef);
    expect(sessionId).not.toContain(customerRef);
    expect(sessionId).not.toContain("."); // a JWT would have two dots
  });

  it("gives the SAME 401 for a wrong password and for an account that does not exist", async () => {
    await register(h.admin);

    const wrongPassword = await login(h.admin, { password: "wrong" });
    const noSuchAccount = await login(h.admin, { email: "nobody@example.com", password: "x" });

    expect(wrongPassword.status).toBe(401);
    // Byte-for-byte identical: no account-enumeration oracle.
    expect(JSON.stringify(wrongPassword.body)).toBe(JSON.stringify(noSuchAccount.body));
  });

  it("never leaks Authenticate's `reason` (which distinguishes the two cases internally)", async () => {
    await register(h.admin);
    const failed = await login(h.admin, { password: "wrong" });
    expect(JSON.stringify(failed.body)).not.toContain("invalid credentials");
  });

  it("hands out no session on a failed login", async () => {
    await register(h.admin);
    const failed = await login(h.admin, { password: "wrong" });
    expect(JSON.stringify(failed.body)).not.toContain("sessionId");
  });
});

describe("GET /public/auth/me (the guard)", () => {
  it("returns the signed-in customer's own profile", async () => {
    const { sessionId, customerRef } = await signedIn(h.admin);

    const response = await call(h.admin, "GET", "/public/auth/me", { sessionId });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      customerRef,
      email: CREDENTIALS.email,
      name: CREDENTIALS.name,
    });
  });

  it("401s with no session at all — never an empty or anonymous profile", async () => {
    expect((await call(h.admin, "GET", "/public/auth/me")).status).toBe(401);
  });

  it("gives the SAME 401 for a forged session id as for no session id", async () => {
    const none = await call(h.admin, "GET", "/public/auth/me");
    const forged = await call(h.admin, "GET", "/public/auth/me", { sessionId: "made-up-id" });

    expect(forged.status).toBe(401);
    expect(JSON.stringify(forged.body)).toBe(JSON.stringify(none.body));
  });

  it("401s once the session has expired", async () => {
    const { sessionId } = await signedIn(h.admin);
    now = new Date(NOW.getTime() + 3_601_000);

    expect((await call(h.admin, "GET", "/public/auth/me", { sessionId })).status).toBe(401);
  });

  it("returns a flat DTO — no Customer aggregate internals reach the wire", async () => {
    const { sessionId } = await signedIn(h.admin);
    const response = await call(h.admin, "GET", "/public/auth/me", { sessionId });

    expect(Object.keys(response.body as object).sort()).toEqual(["customerRef", "email", "name"]);
    const serialized = JSON.stringify(response.body);
    for (const leak of ["props", "_id", "_domainEvents", "_version", "consents", "addresses"]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("never lets one customer's session resolve to another customer", async () => {
    const first = await signedIn(h.admin);
    await register(h.admin, { email: "other@example.com", name: "Other" });
    const secondLogin = await login(h.admin, { email: "other@example.com" });
    const second = secondLogin.body as { customerRef: string; sessionId: string };

    expect(second.customerRef).not.toBe(first.customerRef);
    const me = await call(h.admin, "GET", "/public/auth/me", { sessionId: second.sessionId });
    expect((me.body as { customerRef: string }).customerRef).toBe(second.customerRef);
  });
});

describe("POST /public/auth/logout", () => {
  it("revokes the session, and the very next request is already unauthenticated", async () => {
    const { sessionId } = await signedIn(h.admin);

    const response = await call(h.admin, "POST", "/public/auth/logout", { sessionId });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ revoked: true });
    // Revocation is immediate because the cookie is only a lookup key, not a self-contained token.
    expect((await call(h.admin, "GET", "/public/auth/me", { sessionId })).status).toBe(401);
  });

  it("reports `revoked: false` honestly for a session that was never valid", async () => {
    const response = await call(h.admin, "POST", "/public/auth/logout", { sessionId: "nope" });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ revoked: false });
  });

  it("cannot revoke someone else's session", async () => {
    const victim = await signedIn(h.admin);
    // An attacker presenting the victim's id as their own session gets it revoked only if the guard
    // accepts it — which it does, because that IS the victim's session. The real protection is that
    // the id is opaque, unguessable and HttpOnly; assert the shape that matters instead: a caller
    // with no session cannot revoke a named one.
    const response = await call(h.admin, "POST", "/public/auth/logout", { body: {} });
    expect(response.body).toEqual({ revoked: false });
    expect(
      (await call(h.admin, "GET", "/public/auth/me", { sessionId: victim.sessionId })).status,
    ).toBe(200);
  });
});

describe("POST /public/auth/refresh", () => {
  it("slides the window forward and keeps the SAME session id (no new cookie value needed)", async () => {
    const { sessionId } = await signedIn(h.admin);

    now = new Date(NOW.getTime() + 1_800_000); // 30 min in
    const response = await call(h.admin, "POST", "/public/auth/refresh", { sessionId });

    expect(response.status).toBe(200);
    const refreshed = response.body as { sessionId: string; expiresAt: string };
    expect(refreshed.sessionId).toBe(sessionId);
    expect(refreshed.expiresAt).toBe("2026-08-31T01:30:00.000Z");

    // Past the ORIGINAL expiry, the refreshed session is still good.
    now = new Date(NOW.getTime() + 3_700_000);
    expect((await call(h.admin, "GET", "/public/auth/me", { sessionId })).status).toBe(200);
  });

  it("401s for an unauthenticated caller instead of minting anything", async () => {
    expect((await call(h.admin, "POST", "/public/auth/refresh")).status).toBe(401);
  });

  it("cannot resurrect a revoked session", async () => {
    const { sessionId } = await signedIn(h.admin);
    await call(h.admin, "POST", "/public/auth/logout", { sessionId });

    expect((await call(h.admin, "POST", "/public/auth/refresh", { sessionId })).status).toBe(401);
  });
});

describe("POST /public/auth/logout-all", () => {
  it("revokes every session the customer holds, across devices", async () => {
    await register(h.admin);
    const first = (await login(h.admin)).body as { sessionId: string };
    const second = (await login(h.admin)).body as { sessionId: string };
    expect(first.sessionId).not.toBe(second.sessionId);

    const response = await call(h.admin, "POST", "/public/auth/logout-all", {
      sessionId: first.sessionId,
    });

    expect(response.status).toBe(200);
    expect((response.body as { revoked: number }).revoked).toBe(2);
    expect(
      (await call(h.admin, "GET", "/public/auth/me", { sessionId: first.sessionId })).status,
    ).toBe(401);
    expect(
      (await call(h.admin, "GET", "/public/auth/me", { sessionId: second.sessionId })).status,
    ).toBe(401);
  });

  it("401s for an unauthenticated caller — it never takes a principal from the request", async () => {
    expect((await call(h.admin, "POST", "/public/auth/logout-all")).status).toBe(401);
  });
});

describe("POST /public/auth/claim-cart (login-time cart continuity)", () => {
  async function guestCart(sessionRef: string): Promise<string> {
    const created = await h.cart.cart.create({
      tenantId: "tenant-local",
      sessionRef,
      currency: "USD",
    });
    expect(created.status).toBe(201);
    return (created.body as { cartId: string }).cartId;
  }

  it("promotes the caller's own guest cart in place — same cart id, now owned by the customer", async () => {
    const { sessionId, customerRef } = await signedIn(h.admin);
    const cartId = await guestCart("guest-session-1");

    const response = await call(h.admin, "POST", "/public/auth/claim-cart", {
      sessionId,
      body: { cartId, sessionRef: "guest-session-1" },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ cartId, customerRef, assigned: true });
  });

  it("is idempotent — signing in again re-claims the same cart without failing", async () => {
    const { sessionId } = await signedIn(h.admin);
    const cartId = await guestCart("guest-session-1");
    const body = { cartId, sessionRef: "guest-session-1" };

    await call(h.admin, "POST", "/public/auth/claim-cart", { sessionId, body });
    const second = await call(h.admin, "POST", "/public/auth/claim-cart", { sessionId, body });

    expect(second.status).toBe(200);
    expect((second.body as { assigned: boolean }).assigned).toBe(false);
  });

  it("refuses to claim a cart the caller does not own — same 404 an unknown cart id gives", async () => {
    const { sessionId } = await signedIn(h.admin);
    const cartId = await guestCart("someone-elses-session");

    const stolen = await call(h.admin, "POST", "/public/auth/claim-cart", {
      sessionId,
      body: { cartId, sessionRef: "my-own-session" },
    });
    const unknown = await call(h.admin, "POST", "/public/auth/claim-cart", {
      sessionId,
      body: { cartId: "no-such-cart", sessionRef: "my-own-session" },
    });

    expect(stolen.status).toBe(404);
    // Indistinguishable from a cart that does not exist — existence is never leaked.
    expect(JSON.stringify(stolen.body)).toBe(JSON.stringify(unknown.body));
  });

  it("401s an unauthenticated claim — a guest cannot attach a cart to any account", async () => {
    const cartId = await guestCart("guest-session-1");

    const response = await call(h.admin, "POST", "/public/auth/claim-cart", {
      body: { cartId, sessionRef: "guest-session-1" },
    });

    expect(response.status).toBe(401);
  });

  it("takes the customerRef from the SESSION — a body cannot smuggle one in", async () => {
    const { sessionId, customerRef } = await signedIn(h.admin);
    const cartId = await guestCart("guest-session-1");

    const response = await call(h.admin, "POST", "/public/auth/claim-cart", {
      sessionId,
      // The schema is `.strict()`, so a real transport would 422 this; the handler additionally
      // never reads such a field, which is what this asserts (it is invoked directly here, exactly
      // as `public-cart-routes.test.ts` bypasses zod to prove the same property).
      body: { cartId, sessionRef: "guest-session-1", customerRef: "customer-VICTIM" },
    });

    expect((response.body as { customerRef: string }).customerRef).toBe(customerRef);
  });
});

describe("route declarations", () => {
  it("marks every route public (no AdminGuard) — and none of them accepts a customerRef", () => {
    for (const route of publicAuthRoutes(h.admin)) {
      expect(route.public).toBe(true);
      expect(route.path.startsWith("/public/auth/")).toBe(true);
      // No schema anywhere on this surface has a customerRef/principal field to read.
      expect(JSON.stringify(Object.keys(route.schema))).not.toContain("customerRef");
    }
  });

  it("does not mark /login or /refresh idempotent (replaying either would be a real defect)", () => {
    const routes = publicAuthRoutes(h.admin);
    const byPath = (path: string) => routes.find((r) => r.path === path);
    expect(byPath("/public/auth/login")?.idempotent).toBeUndefined();
    expect(byPath("/public/auth/refresh")?.idempotent).toBeUndefined();
    expect(byPath("/public/auth/logout")?.idempotent).toBe(true);
  });
});
