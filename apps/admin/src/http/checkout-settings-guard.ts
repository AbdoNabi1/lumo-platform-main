import {
  DEFAULT_CHECKOUT_SETTINGS,
  toPublicCheckoutSettings,
  type PublicCheckoutSettings,
} from "@platform/checkout";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";

/**
 * Wave 2a (D34): the public routes read the shop's checkout settings and enforce them on the
 * SERVER. A shop that never saved any settings (or a unit-test slice of `WiredAdmin` with no
 * Checkout wired) gets today's behaviour - every rule off - so nothing changes until a merchant
 * opts in.
 */
export async function readCheckoutSettings(
  admin: WiredAdmin,
  tenantId: string,
): Promise<PublicCheckoutSettings> {
  const checkout = (admin.publicReads as Partial<WiredAdmin["publicReads"]> | undefined)?.checkout;
  if (checkout === undefined) return toPublicCheckoutSettings(DEFAULT_CHECKOUT_SETTINGS);
  const response = await checkout.getPublicSettings({ tenantId });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`could not read the checkout settings (${response.status})`);
  }
  return response.body as PublicCheckoutSettings;
}

/** 403 `LOGIN_REQUIRED`: the shop asks shoppers to sign in before checking out. */
export function loginRequiredResponse(): AdminResponse {
  return {
    status: 403,
    body: { code: "LOGIN_REQUIRED", message: "Sign in to check out", retryable: false, fields: [] },
  };
}

/** 403 `ACCOUNTS_DISABLED`: the shop has turned customer accounts off. */
export function accountsDisabledResponse(): AdminResponse {
  return {
    status: 403,
    body: {
      code: "ACCOUNTS_DISABLED",
      message: "Customer accounts are turned off for this store",
      retryable: false,
      fields: [],
    },
  };
}

/**
 * When the shop requires login, the caller must present a valid customer session
 * (`x-customer-session`, the same proof every customer route uses); a guest gets
 * {@link loginRequiredResponse}. Null means "carry on".
 */
export async function loginRequirement(
  admin: WiredAdmin,
  tenantId: string,
  customerSessionId: string | undefined,
  settings: PublicCheckoutSettings,
): Promise<AdminResponse | null> {
  if (!settings.requireLogin) return null;
  const guarded = await admin.customerAuth.requireSession(customerSessionId, tenantId);
  return guarded.ok ? null : loginRequiredResponse();
}
