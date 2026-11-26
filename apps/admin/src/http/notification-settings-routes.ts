import { z } from "zod";
import type { RateLimiter } from "@platform/contracts";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";
import { rateLimited } from "./rate-limited-response";

/** Test mails per store per hour. Fail-closed: no limiter, or a limiter that errors, sends nothing. */
export const TEST_EMAIL_LIMIT = 10;
export const TEST_EMAIL_WINDOW_MS = 60 * 60 * 1000;

const settingsBody = z
  .object({
    senderEmail: z.string().nullable(),
    staffRecipients: z.array(z.string()),
    disabledTemplates: z.array(z.string()),
    /** null when the page loaded the defaults (no row yet). */
    expectedVersion: z.number().int().min(1).nullable(),
  })
  .strict();

const templateParams = z.object({
  key: z.string().min(1).max(64),
  locale: z.string().min(1).max(8),
});
const keyParams = z.object({ key: z.string().min(1).max(64) });

const copyBody = z.object({ subject: z.string(), body: z.string() }).strict();

/** The draft the editor shows; both or neither. `locale` defaults to English. */
const draftBody = z
  .object({
    locale: z.string().min(1).max(8).optional(),
    subject: z.string().optional(),
    body: z.string().optional(),
  })
  .strict();

/**
 * Wave 2b: Settings > Notifications. Per request tenant; the actor is `context.principal`. The test
 * mail has no recipient field at all: it is sent to the signed-in member's own address, which the
 * server resolves from the principal. `rateLimiter` is the platform's (the real wiring always passes it).
 */
export function notificationSettingsRoutes(
  admin: WiredAdmin,
  rateLimiter?: RateLimiter,
): readonly RouteDefinition[] {
  const testBudget = async (tenantId: string) => {
    if (rateLimiter === undefined) {
      return rateLimited(60_000, "Test emails are unavailable right now. Try again later.");
    }
    try {
      const decision = await rateLimiter.consume(
        `rl:${tenantId}:notification-test-email`,
        TEST_EMAIL_LIMIT,
        TEST_EMAIL_WINDOW_MS,
      );
      return decision.allowed
        ? null
        : rateLimited(decision.retryAfterMs, "You've sent a lot of test emails. Try again later.");
    } catch {
      return rateLimited(60_000, "Test emails are unavailable right now. Try again later.");
    }
  };

  return [
    defineRoute({
      method: "GET",
      path: "/notifications/settings",
      version: 1,
      permission: "settings:read",
      summary: "The shop's notification settings, sender summary and whether email really delivers",
      schema: {},
      handle: ({ context }) =>
        admin.notificationSettings.getSettings(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/notifications/settings",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary:
        "Save the sender email, staff recipients and which templates are on (409 when stale)",
      schema: { body: settingsBody },
      handle: ({ body, context }) => {
        const { expectedVersion, ...values } = body;
        return admin.notificationSettings.updateSettings(context.principal, {
          tenantId: context.tenantId,
          expectedVersion,
          values,
        });
      },
    }),
    defineRoute({
      method: "GET",
      path: "/notifications/templates",
      version: 1,
      permission: "settings:read",
      summary: "Every notification template with its current copy in each language",
      schema: {},
      handle: ({ context }) =>
        admin.notificationSettings.listTemplates(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "GET",
      path: "/notifications/templates/:key/:locale",
      version: 1,
      permission: "settings:read",
      summary: "One template in one language, with its default copy and variables",
      schema: { params: templateParams },
      handle: ({ params, context }) =>
        admin.notificationSettings.getTemplate(context.principal, {
          tenantId: context.tenantId,
          key: params.key,
          locale: params.locale,
        }),
    }),
    defineRoute({
      method: "PUT",
      path: "/notifications/templates/:key/:locale",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary: "Save the merchant's own subject and body for one template and language",
      schema: { params: templateParams, body: copyBody },
      handle: ({ params, body, context }) =>
        admin.notificationSettings.putTemplate(context.principal, {
          tenantId: context.tenantId,
          key: params.key,
          locale: params.locale,
          subject: body.subject,
          body: body.body,
        }),
    }),
    defineRoute({
      method: "DELETE",
      path: "/notifications/templates/:key/:locale",
      version: 1,
      permission: "settings:update",
      summary: "Revert one template and language to the default copy",
      schema: { params: templateParams },
      handle: ({ params, context }) =>
        admin.notificationSettings.revertTemplate(context.principal, {
          tenantId: context.tenantId,
          key: params.key,
          locale: params.locale,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/notifications/templates/:key/preview",
      version: 1,
      permission: "settings:read",
      summary: "Render a template (the saved copy or an unsaved draft) with sample data",
      schema: { params: keyParams, body: draftBody },
      handle: ({ params, body, context }) =>
        admin.notificationSettings.previewTemplate(context.principal, {
          tenantId: context.tenantId,
          key: params.key,
          ...(body.locale === undefined ? {} : { locale: body.locale }),
          ...(body.subject === undefined ? {} : { subject: body.subject }),
          ...(body.body === undefined ? {} : { body: body.body }),
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/notifications/templates/:key/test",
      version: 1,
      permission: "settings:update",
      summary: "Send the template, with sample data, to your own email address",
      schema: { params: keyParams, body: draftBody },
      handle: async ({ params, body, context }) => {
        const limited = await testBudget(context.tenantId);
        if (limited !== null) return limited;
        return admin.notificationSettings.sendTest(context.principal, {
          tenantId: context.tenantId,
          key: params.key,
          ...(body.locale === undefined ? {} : { locale: body.locale }),
          ...(body.subject === undefined ? {} : { subject: body.subject }),
          ...(body.body === undefined ? {} : { body: body.body }),
        });
      },
    }),
  ] as readonly RouteDefinition[];
}
