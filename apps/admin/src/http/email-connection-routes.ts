import { z } from "zod";
import type { RateLimiter } from "@platform/contracts";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";
import { rateLimited } from "./rate-limited-response";

/** Connection test mails per store per hour (saving and "Send test" both send one). Fail-closed. */
export const EMAIL_CONNECTION_TEST_LIMIT = 10;
export const EMAIL_CONNECTION_TEST_WINDOW_MS = 60 * 60 * 1000;

/**
 * `apiKey` is write-only: it is accepted here and never returned. `.max` bounds a pasted blob; the
 * shape rules (a Resend key) are the use case's. Absent/empty keeps the stored key.
 */
const saveBody = z
  .object({
    kind: z.string().min(1).max(32),
    fromEmail: z.string().max(320),
    apiKey: z.string().max(300).nullable().optional(),
    /**
     * Mailbox (SMTP) accounts: the preset and, for `custom`, host/port/security, plus the username. The
     * server decides the rest from the preset; the rules are the use case's. No password in here.
     */
    smtp: z
      .object({
        preset: z.string().min(1).max(16),
        host: z.string().max(253).optional(),
        port: z.number().int().optional(),
        security: z.string().max(16).optional(),
        username: z.string().max(320),
      })
      .strict()
      .nullable()
      .optional(),
    /** Write-only mailbox password: accepted here, never returned. Absent/empty keeps the stored one. */
    password: z.string().max(300).nullable().optional(),
    /** null when the page loaded "not connected". */
    expectedVersion: z.number().int().min(1).nullable(),
  })
  .strict();

const enabledBody = z
  .object({ enabled: z.boolean(), expectedVersion: z.number().int().min(1) })
  .strict();

/** No recipient field at all: the test mail goes to the signed-in member's own address. */
const noBody = z.object({}).strict();

/**
 * Wave 2b2: the store's own email account. Per request tenant. 503 NOT_CONFIGURED "Not available yet"
 * while the runtime has no `EMAIL_CREDENTIALS_KEK_REF`. The key is never in a response.
 */
export function emailConnectionRoutes(
  admin: WiredAdmin,
  rateLimiter?: RateLimiter,
): readonly RouteDefinition[] {
  const testBudget = async (tenantId: string) => {
    if (rateLimiter === undefined) {
      return rateLimited(60_000, "Test emails are unavailable right now. Try again later.");
    }
    try {
      const decision = await rateLimiter.consume(
        `rl:${tenantId}:email-connection-test`,
        EMAIL_CONNECTION_TEST_LIMIT,
        EMAIL_CONNECTION_TEST_WINDOW_MS,
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
      path: "/notifications/email-connection",
      version: 1,
      permission: "settings:read",
      summary: "The store's own email account: status, From address, last four of the key",
      schema: {},
      handle: ({ context }) =>
        admin.emailConnection.get(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "PUT",
      path: "/notifications/email-connection",
      version: 1,
      permission: "settings:update",
      summary:
        "Connect or update the store's email account: seals the key and sends a test mail to you",
      schema: { body: saveBody },
      handle: async ({ body, context }) => {
        const limited = await testBudget(context.tenantId);
        if (limited !== null) return limited;
        return admin.emailConnection.save(context.principal, {
          tenantId: context.tenantId,
          expectedVersion: body.expectedVersion,
          kind: body.kind,
          fromEmail: body.fromEmail,
          apiKey: body.apiKey ?? null,
          smtp: body.smtp ?? undefined,
          password: body.password ?? null,
        });
      },
    }),
    defineRoute({
      method: "DELETE",
      path: "/notifications/email-connection",
      version: 1,
      permission: "settings:update",
      summary: "Disconnect the store's email account: the sealed key is deleted",
      schema: {},
      handle: ({ context }) =>
        admin.emailConnection.remove(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/notifications/email-connection/test",
      version: 1,
      permission: "settings:update",
      summary: "Send a test email to your own address through the store's email account",
      schema: { body: noBody },
      handle: async ({ context }) => {
        const limited = await testBudget(context.tenantId);
        if (limited !== null) return limited;
        return admin.emailConnection.test(context.principal, { tenantId: context.tenantId });
      },
    }),
    defineRoute({
      method: "POST",
      path: "/notifications/email-connection/enabled",
      version: 1,
      permission: "settings:update",
      summary: "Switch the store's email account on or off (off: no customer email is sent)",
      schema: { body: enabledBody },
      handle: ({ body, context }) =>
        admin.emailConnection.setEnabled(context.principal, {
          tenantId: context.tenantId,
          expectedVersion: body.expectedVersion,
          enabled: body.enabled,
        }),
    }),
  ] as readonly RouteDefinition[];
}
