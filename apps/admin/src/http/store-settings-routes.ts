import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

const settingsBody = z.object({
  storeName: z.string().max(200),
  contactEmail: z.string().max(320).nullable(),
  currency: z.string().length(3),
  timezone: z.string().min(1).max(64),
  weightUnit: z.string().min(1).max(8),
});

/**
 * Plan 3C — Settings → General. `PUT` saves first, then relabels the shop's variant prices when the
 * save succeeded: the relabel is idempotent, so a failure here (500) is finished by the merchant's
 * retry. The public route returns the shop's name and currency and nothing else.
 */
export function storeSettingsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/store/settings",
      version: 1,
      permission: "settings:read",
      summary:
        "The shop's general settings (name, contact email, currency, time zone, weight unit)",
      schema: {},
      handle: ({ context }) => admin.tenancy.getStoreSettings(context.principal),
    }),
    defineRoute({
      method: "PUT",
      path: "/store/settings",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary: "Save the shop's general settings; a new currency relabels prices, keeping amounts",
      schema: { body: settingsBody },
      handle: async ({ body, context }) => {
        const saved = await admin.tenancy.updateStoreSettings(context.principal, body);
        if (saved.status >= 300) return saved;
        await admin.storeCurrency.relabel(context.tenantId, body.currency);
        return saved;
      },
    }),
    defineRoute({
      method: "GET",
      path: "/public/store",
      version: 1,
      permission: "tenancy:read",
      public: true,
      summary: "Public: the shop's name and currency (nothing else)",
      schema: {},
      handle: () => admin.tenancy.getPublicStore(),
    }),
  ] as readonly RouteDefinition[];
}
