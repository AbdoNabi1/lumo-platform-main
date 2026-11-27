import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

/**
 * Wave 2a: the whole settings document plus the version the page loaded. `.strict()` so an unknown
 * key is a 422 rather than silently ignored; zod checks structure, the use case checks the rules
 * (ranges, "no login requirement while accounts are off").
 */
const settingsBody = z
  .object({
    nameMode: z.string(),
    phoneMode: z.string(),
    line2Mode: z.string(),
    marketingEmailPrompt: z.string(),
    cartLineLimit: z.number().nullable(),
    requireLogin: z.boolean(),
    accountsMode: z.string(),
    showAccountLink: z.boolean(),
    /** null when the page loaded the defaults (no row yet). */
    expectedVersion: z.number().int().min(1).nullable(),
  })
  .strict();

/**
 * Settings > Checkout and Settings > Customer accounts. The admin routes are per request tenant (the
 * repository takes the tenant per call). The public read hands the storefront exactly the eight
 * switches it needs: no version, no tenant, nothing else. The storefront reads it uncached at
 * checkout; the SERVER also enforces every switch (see the public cart, checkout and auth routes).
 */
export function checkoutSettingsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/checkout/settings",
      version: 1,
      permission: "settings:read",
      summary: "The shop's checkout and customer-account settings (defaults when never saved)",
      schema: {},
      handle: ({ context }) =>
        admin.checkout.getSettings(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/checkout/settings",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary: "Save the shop's checkout and customer-account settings (409 when stale)",
      schema: { body: settingsBody },
      handle: ({ body, context }) => {
        const { expectedVersion, ...values } = body;
        return admin.checkout.updateSettings(context.principal, {
          tenantId: context.tenantId,
          expectedVersion,
          values,
        });
      },
    }),
    defineRoute({
      method: "GET",
      path: "/public/checkout-settings",
      version: 1,
      permission: "checkout:read",
      public: true,
      summary: "Public: the checkout and customer-account switches the storefront needs",
      schema: {},
      handle: ({ context }) =>
        admin.publicReads.checkout.getPublicSettings({ tenantId: context.tenantId }),
    }),
  ] as readonly RouteDefinition[];
}
