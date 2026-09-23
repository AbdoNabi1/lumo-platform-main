import { beforeEach, describe, expect, it, vi } from "vitest";

const registerCustomer = vi.fn();
const loginCustomer = vi.fn();
const logoutCustomer = vi.fn();
const logoutCustomerEverywhere = vi.fn();
const getCurrentCart = vi.fn();
const claimGuestCart = vi.fn();
const completeSignup = vi.fn();

vi.mock("@/lib/runtime-api", () => ({
  registerCustomer: (...args: unknown[]) => registerCustomer(...args),
  loginCustomer: (...args: unknown[]) => loginCustomer(...args),
  logoutCustomer: (...args: unknown[]) => logoutCustomer(...args),
  logoutCustomerEverywhere: (...args: unknown[]) => logoutCustomerEverywhere(...args),
  getCurrentCart: (...args: unknown[]) => getCurrentCart(...args),
  claimGuestCart: (...args: unknown[]) => claimGuestCart(...args),
  completeSignup: (...args: unknown[]) => completeSignup(...args),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

interface StoredCookie {
  readonly value: string;
  readonly options: Record<string, unknown>;
}
let cookieStore = new Map<string, StoredCookie>();
const cookieSet = vi.fn((name: string, value: string, options: Record<string, unknown> = {}) => {
  cookieStore.set(name, { value, options });
});
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const stored = cookieStore.get(name);
      return stored === undefined ? undefined : { value: stored.value };
    },
    set: cookieSet,
  }),
}));

const actions = await import("./actions");
const { CUSTOMER_SESSION_COOKIE } = await import("@/lib/customer-session");
const { GUEST_SESSION_COOKIE } = await import("@/lib/cart");

const SESSION = {
  status: 200,
  body: { sessionId: "session-abc", customerRef: "customer-1", expiresAt: "2026-08-31T01:00:00Z" },
};

beforeEach(() => {
  cookieStore = new Map();
  for (const spy of [
    registerCustomer,
    loginCustomer,
    logoutCustomer,
    logoutCustomerEverywhere,
    getCurrentCart,
    claimGuestCart,
    completeSignup,
    revalidatePath,
  ]) {
    spy.mockReset();
  }
  // `mockClear`, not `mockReset` — resetting would strip `cookieSet`'s implementation (the write
  // into `cookieStore`), leaving every cookie assertion silently passing against an empty store.
  cookieSet.mockClear();
  getCurrentCart.mockResolvedValue({ status: 200, body: { cart: null } });
});

describe("signIn", () => {
  it("stores ONLY the opaque session id in the cookie — never the customerRef", async () => {
    loginCustomer.mockResolvedValue(SESSION);

    const result = await actions.signIn("shopper@example.com", "correct-horse");

    expect(result).toEqual({ ok: true });
    const stored = cookieStore.get(CUSTOMER_SESSION_COOKIE);
    expect(stored?.value).toBe("session-abc");
    expect(stored?.value).not.toContain("customer-1");
    expect(stored?.options.httpOnly).toBe(true);
  });

  it("never writes a cookie when authentication failed", async () => {
    loginCustomer.mockResolvedValue({ status: 401, body: null });

    const result = await actions.signIn("shopper@example.com", "wrong");

    expect(result).toEqual({ ok: false, reason: "credentials" });
    expect(cookieStore.has(CUSTOMER_SESSION_COOKIE)).toBe(false);
  });

  it("maps a 403 to `mfa` and every other failure honestly", async () => {
    loginCustomer.mockResolvedValue({ status: 403, body: null });
    expect(await actions.signIn("a@b.com", "p")).toEqual({ ok: false, reason: "mfa" });

    loginCustomer.mockResolvedValue({ status: 0, body: null });
    expect(await actions.signIn("a@b.com", "p")).toEqual({ ok: false, reason: "network" });
  });

  it("never returns the submitted password in any branch", async () => {
    loginCustomer.mockResolvedValue({ status: 401, body: null });
    const failed = await actions.signIn("a@b.com", "hunter2");
    expect(JSON.stringify(failed)).not.toContain("hunter2");

    loginCustomer.mockResolvedValue(SESSION);
    const ok = await actions.signIn("a@b.com", "hunter2");
    expect(JSON.stringify(ok)).not.toContain("hunter2");
  });

  it("claims the guest cart on login, passing the guest sessionRef as ownership proof", async () => {
    cookieStore.set(GUEST_SESSION_COOKIE, { value: "guest-1", options: {} });
    getCurrentCart.mockResolvedValue({ status: 200, body: { cart: { id: "cart-9" } } });
    loginCustomer.mockResolvedValue(SESSION);
    claimGuestCart.mockResolvedValue({ status: 200, body: { cartId: "cart-9", assigned: true } });

    await actions.signIn("shopper@example.com", "correct-horse");

    expect(claimGuestCart).toHaveBeenCalledWith(
      "session-abc",
      "cart-9",
      "guest-1",
      expect.any(String),
    );
  });

  it("KEEPS the guest cookie after claiming — it is still the only key to that cart", async () => {
    // Deliberate deviation from T5.16 §2 (which said to clear it): `CartRepository` has no
    // `findByCustomerRef`, so `sessionRef` remains the only way to resolve "my current cart".
    // Clearing it would strand the just-claimed cart. See BLOCKERS.md's T5.17 entry.
    cookieStore.set(GUEST_SESSION_COOKIE, { value: "guest-1", options: {} });
    getCurrentCart.mockResolvedValue({ status: 200, body: { cart: { id: "cart-9" } } });
    loginCustomer.mockResolvedValue(SESSION);
    claimGuestCart.mockResolvedValue({ status: 200, body: { cartId: "cart-9", assigned: true } });

    await actions.signIn("shopper@example.com", "correct-horse");

    expect(cookieStore.get(GUEST_SESSION_COOKIE)?.value).toBe("guest-1");
  });

  it("does not attempt a claim when the shopper has no guest cart", async () => {
    loginCustomer.mockResolvedValue(SESSION);

    await actions.signIn("shopper@example.com", "correct-horse");

    expect(claimGuestCart).not.toHaveBeenCalled();
  });

  it("still signs the shopper in when the cart claim fails — login must not depend on it", async () => {
    cookieStore.set(GUEST_SESSION_COOKIE, { value: "guest-1", options: {} });
    getCurrentCart.mockResolvedValue({ status: 200, body: { cart: { id: "cart-9" } } });
    loginCustomer.mockResolvedValue(SESSION);
    claimGuestCart.mockResolvedValue({ status: 404, body: null });

    const result = await actions.signIn("shopper@example.com", "correct-horse");

    expect(result).toEqual({ ok: true });
    expect(cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value).toBe("session-abc");
  });
});

describe("registerAccount", () => {
  it("registers then signs in with a REAL authentication round trip", async () => {
    registerCustomer.mockResolvedValue({ status: 201, body: { customerRef: "customer-1" } });
    loginCustomer.mockResolvedValue(SESSION);

    const result = await actions.registerAccount("shopper@example.com", "Sam", "correct-horse");

    expect(result).toEqual({ ok: true });
    // The session is never synthesized from the registration response.
    expect(loginCustomer).toHaveBeenCalledWith("shopper@example.com", "correct-horse");
    expect(cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value).toBe("session-abc");
  });

  it("does not attempt a login when registration was rejected", async () => {
    registerCustomer.mockResolvedValue({ status: 409, body: null });

    const result = await actions.registerAccount("taken@example.com", "Sam", "correct-horse");

    expect(result).toEqual({ ok: false, reason: "conflict" });
    expect(loginCustomer).not.toHaveBeenCalled();
    expect(cookieStore.has(CUSTOMER_SESSION_COOKIE)).toBe(false);
  });

  it("sends an Idempotency-Key on the registration write", async () => {
    registerCustomer.mockResolvedValue({ status: 201, body: { customerRef: "customer-1" } });
    loginCustomer.mockResolvedValue(SESSION);

    await actions.registerAccount("shopper@example.com", "Sam", "correct-horse");

    expect(registerCustomer).toHaveBeenCalledWith(
      "shopper@example.com",
      "Sam",
      "correct-horse",
      expect.any(String),
    );
  });

  it("G-72: a check-email response does not sign anyone in and reports checkEmail, not ok", async () => {
    registerCustomer.mockResolvedValue({ status: 202, body: { outcome: "link-sent" } });

    const result = await actions.registerAccount("guest@example.com", "Sam", "correct-horse");

    expect(result).toEqual({ ok: true, checkEmail: true });
    expect(loginCustomer).not.toHaveBeenCalled();
    expect(cookieStore.has(CUSTOMER_SESSION_COOKIE)).toBe(false);
  });
});

describe("completeAccountSignup", () => {
  it("completes then signs in with a REAL authentication round trip", async () => {
    completeSignup.mockResolvedValue({
      status: 201,
      body: { customerRef: "customer-1", email: "guest@example.com" },
    });
    loginCustomer.mockResolvedValue(SESSION);

    const result = await actions.completeAccountSignup("tok-123", "Real Name", "new-password");

    expect(result).toEqual({ ok: true });
    expect(loginCustomer).toHaveBeenCalledWith("guest@example.com", "new-password");
    expect(cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value).toBe("session-abc");
  });

  it("maps a 404 (invalid/expired/reused token) to its own distinct reason", async () => {
    completeSignup.mockResolvedValue({ status: 404, body: null });

    const result = await actions.completeAccountSignup("bogus", "Real Name", "new-password");

    expect(result).toEqual({ ok: false, reason: "invalid-token" });
    expect(loginCustomer).not.toHaveBeenCalled();
  });

  it("sends an Idempotency-Key on the completion write", async () => {
    completeSignup.mockResolvedValue({
      status: 201,
      body: { customerRef: "customer-1", email: "guest@example.com" },
    });
    loginCustomer.mockResolvedValue(SESSION);

    await actions.completeAccountSignup("tok-123", "Real Name", "new-password");

    expect(completeSignup).toHaveBeenCalledWith(
      "tok-123",
      "Real Name",
      "new-password",
      expect.any(String),
    );
  });

  it("never returns the submitted token or password in any branch", async () => {
    completeSignup.mockResolvedValue({ status: 404, body: null });
    const failed = await actions.completeAccountSignup("secret-token", "Real Name", "hunter2");
    expect(JSON.stringify(failed)).not.toContain("secret-token");
    expect(JSON.stringify(failed)).not.toContain("hunter2");
  });
});

describe("signOut", () => {
  it("revokes server-side FIRST, then clears the cookie", async () => {
    cookieStore.set(CUSTOMER_SESSION_COOKIE, { value: "session-abc", options: {} });
    logoutCustomer.mockResolvedValue({ status: 200, body: { revoked: true } });

    const result = await actions.signOut();

    expect(result).toEqual({ ok: true });
    expect(logoutCustomer).toHaveBeenCalledWith("session-abc", expect.any(String));
    expect(cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value).toBe("");
    expect(cookieStore.get(CUSTOMER_SESSION_COOKIE)?.options.maxAge).toBe(0);
  });

  it("keeps the cookie when the revocation call could not be made at all", async () => {
    // Clearing here would leave a live, unrevoked session behind that the shopper believes is closed.
    cookieStore.set(CUSTOMER_SESSION_COOKIE, { value: "session-abc", options: {} });
    logoutCustomer.mockResolvedValue({ status: 0, body: null });

    const result = await actions.signOut();

    expect(result).toEqual({ ok: false, reason: "network" });
    expect(cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value).toBe("session-abc");
  });

  it("clears a stale cookie without calling the API when there is no session", async () => {
    const result = await actions.signOut();

    expect(result).toEqual({ ok: true });
    expect(logoutCustomer).not.toHaveBeenCalled();
    expect(cookieStore.get(CUSTOMER_SESSION_COOKIE)?.options.maxAge).toBe(0);
  });
});

describe("signOutEverywhere", () => {
  it("revokes every session and clears the cookie", async () => {
    cookieStore.set(CUSTOMER_SESSION_COOKIE, { value: "session-abc", options: {} });
    logoutCustomerEverywhere.mockResolvedValue({ status: 200, body: { revoked: 3 } });

    const result = await actions.signOutEverywhere();

    expect(result).toEqual({ ok: true });
    expect(logoutCustomerEverywhere).toHaveBeenCalledWith("session-abc", expect.any(String));
    expect(cookieStore.get(CUSTOMER_SESSION_COOKIE)?.options.maxAge).toBe(0);
  });

  it("does nothing when there is no session to revoke", async () => {
    const result = await actions.signOutEverywhere();

    expect(result).toEqual({ ok: false, reason: "credentials" });
    expect(logoutCustomerEverywhere).not.toHaveBeenCalled();
  });
});
