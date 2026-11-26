import { beforeEach, describe, expect, it, vi } from "vitest";

const registerCustomer = vi.fn();
const loginCustomer = vi.fn();
const completeSignup = vi.fn();
vi.mock("@/lib/runtime-api", () => ({
  registerCustomer: (...args: unknown[]) => registerCustomer(...args),
  loginCustomer: (...args: unknown[]) => loginCustomer(...args),
  completeSignup: (...args: unknown[]) => completeSignup(...args),
  getCurrentCart: vi.fn(),
  claimGuestCart: vi.fn(),
  logoutCustomer: vi.fn(),
  logoutCustomerEverywhere: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const cookieSet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: cookieSet }),
}));

const actions = await import("./actions");

const DISABLED = {
  status: 403,
  body: {
    code: "ACCOUNTS_DISABLED",
    message: "Customer accounts are turned off for this store",
    retryable: false,
    fields: [],
  },
};

beforeEach(() => vi.clearAllMocks());

describe("a shop with customer accounts off (D37)", () => {
  it("sign-in is 'accounts-disabled', not the MFA message, and sets no cookie", async () => {
    loginCustomer.mockResolvedValue(DISABLED);
    expect(await actions.signIn("a@b.co", "pw")).toEqual({
      ok: false,
      reason: "accounts-disabled",
    });
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("register is 'accounts-disabled' and never tries to sign in", async () => {
    registerCustomer.mockResolvedValue(DISABLED);
    expect(await actions.registerAccount("a@b.co", "A", "pw123456")).toEqual({
      ok: false,
      reason: "accounts-disabled",
    });
    expect(loginCustomer).not.toHaveBeenCalled();
  });

  it("signup completion is 'accounts-disabled'", async () => {
    completeSignup.mockResolvedValue(DISABLED);
    expect(await actions.completeAccountSignup("tok", "A", "pw123456")).toEqual({
      ok: false,
      reason: "accounts-disabled",
    });
  });

  it("another 403 (an MFA challenge) is still the MFA reason", async () => {
    loginCustomer.mockResolvedValue({ status: 403, body: { code: "MFA_REQUIRED" } });
    expect(await actions.signIn("a@b.co", "pw")).toEqual({ ok: false, reason: "mfa" });
    registerCustomer.mockResolvedValue({ status: 403, body: null });
    expect(await actions.registerAccount("a@b.co", "A", "pw123456")).toEqual({
      ok: false,
      reason: "mfa",
    });
  });
});
