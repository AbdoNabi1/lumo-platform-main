import { describe, expect, it } from "vitest";
import { DEFAULT_CHECKOUT_SETTINGS, toPublicCheckoutSettings } from "@platform/checkout";
import type { WiredAdmin } from "../composition";
import {
  accountsDisabledResponse,
  loginRequiredResponse,
  loginRequirement,
  readCheckoutSettings,
} from "./checkout-settings-guard";

const defaults = toPublicCheckoutSettings(DEFAULT_CHECKOUT_SETTINGS);

describe("readCheckoutSettings", () => {
  it("a slice of WiredAdmin with no Checkout wired behaves as the defaults (every rule off)", async () => {
    const admin = { publicReads: {} } as unknown as WiredAdmin;
    expect(await readCheckoutSettings(admin, "t1")).toEqual(defaults);
    expect(await readCheckoutSettings({} as unknown as WiredAdmin, "t1")).toEqual(defaults);
  });

  it("returns what the checkout controller answers, asking for the request's tenant", async () => {
    const seen: string[] = [];
    const admin = {
      publicReads: {
        checkout: {
          getPublicSettings: async (input: { tenantId: string }) => {
            seen.push(input.tenantId);
            return { status: 200, body: { ...defaults, cartLineLimit: 4 } };
          },
        },
      },
    } as unknown as WiredAdmin;
    expect((await readCheckoutSettings(admin, "tenant-x")).cartLineLimit).toBe(4);
    expect(seen).toEqual(["tenant-x"]);
  });

  it("a failed read is an error, never a silent 'no rules'", async () => {
    const admin = {
      publicReads: { checkout: { getPublicSettings: async () => ({ status: 500, body: {} }) } },
    } as unknown as WiredAdmin;
    await expect(readCheckoutSettings(admin, "t1")).rejects.toThrow(/could not read/);
  });
});

describe("loginRequirement", () => {
  const admin = (ok: boolean) =>
    ({
      customerAuth: {
        requireSession: async () => (ok ? { ok: true, session: {} } : { ok: false, response: {} }),
      },
    }) as unknown as WiredAdmin;

  it("is off by default: no session needed, the session is never even looked up", async () => {
    const throwing = {
      customerAuth: {
        requireSession: () => {
          throw new Error("must not be called");
        },
      },
    } as unknown as WiredAdmin;
    expect(await loginRequirement(throwing, "t1", undefined, defaults)).toBeNull();
  });

  it("on: a guest is refused with LOGIN_REQUIRED", async () => {
    const res = await loginRequirement(admin(false), "t1", undefined, {
      ...defaults,
      requireLogin: true,
    });
    expect(res).toEqual(loginRequiredResponse());
    expect(res?.status).toBe(403);
    expect(res?.body).toMatchObject({ code: "LOGIN_REQUIRED", message: "Sign in to check out" });
  });

  it("on: a valid customer session carries on", async () => {
    expect(
      await loginRequirement(admin(true), "t1", "sess", { ...defaults, requireLogin: true }),
    ).toBeNull();
  });
});

describe("accountsDisabledResponse", () => {
  it("is a 403 with the store message", () => {
    const res = accountsDisabledResponse();
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      code: "ACCOUNTS_DISABLED",
      message: "Customer accounts are turned off for this store",
    });
  });
});
