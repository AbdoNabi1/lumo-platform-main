import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import { IDEMPOTENCY_KEY_MAX, verifyMetaSignature } from "@platform/outreach";
import { ValidationError } from "@platform/utils";
import type { WiredAdmin } from "../composition";

/** The one 401 body: a missing secret, a missing/wrong signature and a malformed header are indistinguishable. */
export const OUTREACH_UNAUTHORIZED_BODY = {
  code: "UNAUTHORIZED",
  message: "Unauthorized",
} as const;
const FORBIDDEN_BODY = { code: "FORBIDDEN", message: "Forbidden" } as const;

const versionBody = z.object({ expectedVersion: z.number().int().min(0) }).strict();
// Embedded Signup hands back an authorization code (up to 8192 characters) and two numeric Meta asset ids.
const assetId = z.string().regex(/^\d{1,64}$/);
const connectBody = z
  .object({ code: z.string().min(1).max(8192), wabaId: assetId, phoneNumberId: assetId })
  .strict();

// A mirror of `TemplateDraft`. The caps only bound abuse; the domain owns the rules and reports an issue code per field
// (422 VALIDATION with `fields:[{field, message:<code>}]`).
const buttonSchema = z
  .object({
    type: z.enum(["QUICK_REPLY", "URL", "PHONE_NUMBER"]),
    text: z.string().max(200),
    url: z.string().max(2100).optional(),
    phoneNumber: z.string().max(32).optional(),
    example: z.string().max(2100).optional(),
  })
  .strict();
const draftBody = z
  .object({
    // The bounds carry the domain's own issue codes (the message becomes the field message), so an empty or overlong
    // name/language answers `name_format` / `language_unsupported`, not Zod prose.
    name: z.string().min(1, "name_format").max(512, "name_format"),
    language: z.string().min(1, "language_unsupported").max(16, "language_unsupported"),
    category: z.enum(["UTILITY", "MARKETING", "AUTHENTICATION"]),
    header: z
      .object({
        format: z.literal("TEXT"),
        text: z.string().max(200),
        example: z.string().max(200).optional(),
      })
      .strict()
      .optional(),
    body: z
      .object({ text: z.string().max(2000), examples: z.array(z.string().max(1024)).max(20) })
      .strict(),
    footer: z
      .object({ text: z.string().max(200) })
      .strict()
      .optional(),
    buttons: z.array(buttonSchema).max(20).optional(),
  })
  .strict();

const templateParams = z.object({ name: z.string().min(1).max(512) });

const testSendBody = z
  .object({
    to: z.string().min(1).max(32),
    templateName: z.string().min(1).max(512),
    language: z.string().min(1).max(16),
    values: z
      .object({
        body: z.array(z.string().max(1024)).max(10),
        header: z.string().max(1024).optional(),
        urlSuffixes: z.record(z.string().regex(/^\d{1,2}$/), z.string().max(2000)).optional(),
      })
      .strict(),
    attestConsent: z.boolean().optional(),
  })
  .strict();
const emailTestBody = z.object({ to: z.string().email().max(320) }).strict();

// Verification is answered uniformly: whatever the query holds (repeated, oversized, bracketed), the handler decides
// between the challenge and 403, so the schema accepts any shape and never produces a 422 on this public route.
const verifyQuery = z.record(z.string(), z.unknown());

/** A scalar query value only (a repeated or bracketed parameter is not one). */
const scalar = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
const CHALLENGE_MAX = 256;

function firstHeader(value: string | readonly string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  return value?.[0];
}

/** Constant-time equality that never throws on a length difference (both sides are hashed first). */
function secretMatches(supplied: string | undefined, configured: string | undefined): boolean {
  if (supplied === undefined || configured === undefined || configured.length === 0) return false;
  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(configured).digest();
  return timingSafeEqual(a, b);
}

/** Both test sends need the caller's `Idempotency-Key`: it becomes the outbound row's idempotency key. */
function requiredIdempotencyKey(
  headers: Readonly<Record<string, string | string[] | undefined>> | undefined,
): string {
  const key = firstHeader(headers?.["idempotency-key"])?.trim();
  if (key === undefined || key.length === 0) {
    throw new ValidationError("An Idempotency-Key header is required", [
      { field: "idempotency-key", message: "required" },
    ]);
  }
  // The same limit the send use case enforces: a key it would always reject never reaches a controller.
  if (key.length > IDEMPOTENCY_KEY_MAX) {
    throw new ValidationError("The Idempotency-Key header is invalid", [
      { field: "idempotency-key", message: "invalid" },
    ]);
  }
  return key;
}

/** Decodes the authenticated bytes once; anything that is not UTF-8 JSON is a 422 (after authentication). */
function decodeJson(raw: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) as unknown;
  } catch {
    throw new ValidationError("The webhook body is not valid JSON", [
      { field: "body", message: "invalid_json" },
    ]);
  }
}

/**
 * Outreach (WhatsApp + email) routes. The merchant routes are guarded by `outreach:read|manage|send` and always run as
 * `context.tenantId`. The two webhook routes are PUBLIC and PLATFORM-scoped: Meta's one app-level URL names no shop, so
 * the transport skips tenant resolution and the lifecycle gate (`x-tenant-id` is never read) and the use case derives the
 * shop from the signed payload's phone number via the platform directory.
 */
export function outreachRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  const { outreach, outreachWebhook } = admin;
  return [
    defineRoute({
      method: "GET",
      path: "/outreach/whatsapp",
      version: 1,
      permission: "outreach:read",
      summary: "WhatsApp connection status (and the Embedded Signup values when available)",
      schema: {},
      handle: ({ context }) =>
        outreach.getConnection(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/outreach/whatsapp/connect",
      version: 1,
      permission: "outreach:manage",
      idempotent: true,
      summary: "Complete Embedded Signup: exchange the code and connect the WhatsApp number",
      schema: { body: connectBody },
      handle: ({ body, context }) =>
        outreach.connect(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/outreach/whatsapp/refresh",
      version: 1,
      permission: "outreach:manage",
      idempotent: true,
      summary: "Refresh the WhatsApp number's status from Meta",
      schema: {},
      handle: ({ context }) => outreach.refresh(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/outreach/whatsapp/disconnect",
      version: 1,
      permission: "outreach:manage",
      idempotent: true,
      summary: "Disconnect WhatsApp",
      schema: { body: versionBody },
      handle: ({ body, context }) =>
        outreach.disconnect(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/outreach/whatsapp/onboarding/abandon",
      version: 1,
      permission: "outreach:manage",
      idempotent: true,
      summary: "Abandon an unfinished WhatsApp onboarding",
      schema: { body: versionBody },
      handle: ({ body, context }) =>
        outreach.abandonOnboarding(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "GET",
      path: "/outreach/whatsapp/templates",
      version: 1,
      permission: "outreach:read",
      summary: "List WhatsApp message templates",
      schema: {},
      handle: ({ context }) =>
        outreach.listTemplates(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/outreach/whatsapp/templates/sync",
      version: 1,
      permission: "outreach:manage",
      idempotent: true,
      summary: "Sync WhatsApp message templates from Meta",
      schema: {},
      handle: ({ context }) =>
        outreach.syncTemplates(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/outreach/whatsapp/templates",
      version: 1,
      permission: "outreach:manage",
      idempotent: true,
      summary: "Create a WhatsApp message template (submitted to Meta for review)",
      schema: { body: draftBody },
      handle: ({ body, context }) =>
        outreach.createTemplate(context.principal, {
          tenantId: context.tenantId,
          draft: body,
        }),
    }),
    defineRoute({
      method: "DELETE",
      path: "/outreach/whatsapp/templates/:name",
      version: 1,
      permission: "outreach:manage",
      idempotent: true,
      summary: "Delete a WhatsApp message template by name",
      schema: { params: templateParams },
      handle: ({ params, context }) =>
        outreach.deleteTemplate(context.principal, {
          tenantId: context.tenantId,
          name: params.name,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/outreach/whatsapp/test-send",
      version: 1,
      permission: "outreach:send",
      idempotent: true,
      summary: "Send a test WhatsApp template message (needs an Idempotency-Key header)",
      schema: { body: testSendBody },
      handle: ({ body, context }) =>
        outreach.testSendWhatsApp(context.principal, {
          ...body,
          tenantId: context.tenantId,
          idempotencyKey: requiredIdempotencyKey(context.headers),
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/outreach/email",
      version: 1,
      permission: "outreach:read",
      summary: "Email sender settings",
      schema: {},
      handle: ({ context }) =>
        outreach.getEmailSettings(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/outreach/email/test-send",
      version: 1,
      permission: "outreach:send",
      idempotent: true,
      summary: "Send a fixed bilingual test email (needs an Idempotency-Key header)",
      schema: { body: emailTestBody },
      handle: ({ body, context }) =>
        outreach.testSendEmail(context.principal, {
          to: body.to,
          tenantId: context.tenantId,
          idempotencyKey: requiredIdempotencyKey(context.headers),
        }),
    }),

    // ── Public, platform-scoped webhook (Meta's single app-level endpoint) ──
    defineRoute({
      method: "GET",
      path: "/public/outreach/whatsapp/webhook",
      version: 1,
      permission: "outreach:record_webhook",
      public: true,
      tenantScope: "platform",
      idempotent: false,
      summary: "Meta webhook verification challenge (answers the plain-text hub.challenge)",
      schema: { querystring: verifyQuery },
      handle: ({ query }) => {
        const challenge = scalar(query["hub.challenge"]);
        const verified =
          scalar(query["hub.mode"]) === "subscribe" &&
          secretMatches(scalar(query["hub.verify_token"]), outreachWebhook.verifyToken) &&
          challenge !== undefined &&
          challenge.length > 0 &&
          challenge.length <= CHALLENGE_MAX;
        if (!verified) return Promise.resolve({ status: 403, body: FORBIDDEN_BODY });
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
          body: challenge,
        });
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/outreach/whatsapp/webhook",
      version: 1,
      permission: "outreach:record_webhook",
      public: true,
      tenantScope: "platform",
      idempotent: false,
      // The transport does not parse this body: it is authenticated as bytes first, then decoded exactly once.
      rawJsonBody: true,
      summary: "Meta webhook delivery (authenticated by X-Hub-Signature-256 over the raw body)",
      schema: {},
      handle: async ({ context }) => {
        const secret = outreachWebhook.appSecret;
        const raw = context.rawBody;
        if (
          secret === undefined ||
          secret.length === 0 ||
          raw === undefined ||
          !verifyMetaSignature(raw, firstHeader(context.headers?.["x-hub-signature-256"]), secret)
        ) {
          return { status: 401, body: OUTREACH_UNAUTHORIZED_BODY };
        }
        const result = await outreachWebhook.process(decodeJson(raw));
        if (!result.ok && result.error.code !== "VALIDATION") throw result.error;
        return { status: 200, body: { received: true } };
      },
    }),
  ] as readonly RouteDefinition[];
}
