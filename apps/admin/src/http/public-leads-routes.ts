import { z } from "zod";
import type { RateLimitDecision, RateLimiter } from "@platform/contracts";
import {
  defineRoute,
  type RequestContext,
  type RouteDefinition,
  type TransportResponse,
} from "@platform/http";
import { sanitizeAttributionSnapshot } from "@platform/tracking";
import { logger, ValidationError } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import { rateLimited } from "./rate-limited-response";

const SHOP_LIMIT = 60;
const VISITOR_LIMIT = 5;
const WINDOW_MS = 10 * 60 * 1000;
const LIMITER_RETRY_MS = 5_000;
/** The same shape the use case checks; refused here first so a bad key never reaches the limiter. */
const SUBMISSION_KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

const submitLeadBody = z
  .object({
    formId: z.string().min(1).max(64),
    name: z.string().min(1).max(120),
    phone: z.string().min(1).max(32),
    email: z.string().max(320).optional(),
    message: z.string().max(2000).optional(),
    sessionId: z.string().min(1).max(64),
    sessionAlreadyEmitted: z.boolean(),
    spamSignals: z.object({ honeypot: z.boolean(), elapsedMs: z.number().int().min(0) }).strict(),
    context: z
      .object({
        pageUrl: z.string().max(2048).nullable(),
        referrer: z.string().max(2048).nullable(),
        ip: z.string().max(64).nullable(),
        userAgent: z.string().max(512).nullable(),
        cookies: z
          .object({
            fbp: z.string().max(512).optional(),
            fbc: z.string().max(512).optional(),
            ttp: z.string().max(512).optional(),
            scid: z.string().max(512).optional(),
            ga: z.string().max(512).optional(),
          })
          .strict(),
        // Tracking P2-D8: forwarded by the storefront server from its own cookie jar (`_mb_id`, the HttpOnly
        // `_mb_clk`) and the page URL. Optional, strict, capped; an older storefront simply omits them.
        visitorId: z.string().max(48).optional(),
        clickIds: z
          .array(
            z
              .object({
                name: z.string().max(32),
                value: z.string().max(1000),
                capturedAt: z.string().max(40),
              })
              .strict(),
          )
          .max(10)
          .optional(),
        utm: z
          .object({
            source: z.string().max(200).optional(),
            medium: z.string().max(200).optional(),
            campaign: z.string().max(200).optional(),
            content: z.string().max(200).optional(),
            term: z.string().max(200).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

type SubmitLeadBody = z.infer<typeof submitLeadBody>;

/** The same 503 `packages/http` answers when its own limiter is down. */
function limiterUnavailable(context: RequestContext, reason: string): TransportResponse {
  logger.error("rate limiter unavailable; failing closed", {
    requestId: context.requestId,
    route: "/public/leads",
    error: reason,
  });
  return {
    status: 503,
    body: {
      code: "UNAVAILABLE",
      message: "Service temporarily unavailable",
      retryable: true,
      fields: [],
      retryAfterMs: LIMITER_RETRY_MS,
    },
    headers: { "retry-after": String(Math.ceil(LIMITER_RETRY_MS / 1000)) },
  };
}

/**
 * The `Idempotency-Key` header, looked up case-insensitively. Missing, repeated or malformed ⇒ null.
 * This route is NOT `idempotent: true` (the transport would snapshot a transient 429/503 for 24 h);
 * the key is stored on the lead instead, so only a saved lead is ever replayed.
 */
function submissionKeyOf(context: RequestContext): string | null {
  const headers = context.headers ?? {};
  const name = Object.keys(headers).find((h) => h.toLowerCase() === "idempotency-key");
  const value = name === undefined ? undefined : headers[name];
  return typeof value === "string" && SUBMISSION_KEY_PATTERN.test(value) ? value : null;
}

async function consume(
  limiter: RateLimiter,
  context: RequestContext,
  key: string,
  limit: number,
): Promise<TransportResponse | null> {
  let decision: RateLimitDecision;
  try {
    decision = await limiter.consume(key, limit, WINDOW_MS);
  } catch (error) {
    return limiterUnavailable(context, error instanceof Error ? error.message : String(error));
  }
  return decision.allowed ? null : rateLimited(decision.retryAfterMs, "Too many submissions");
}

/**
 * Null lets the submission through. The limiter is REQUIRED: an anonymous write that creates rows
 * never runs unlimited (absent or throwing ⇒ 503). Buckets are per shop (60 / 10 min) and, when the
 * storefront forwarded the visitor's address, per visitor (5 / 10 min); the transport's own `ip` is
 * the storefront server's, so it is never used here.
 */
async function refuseSubmission(
  limiter: RateLimiter | undefined,
  context: RequestContext,
  tenantId: string,
  visitorIp: string | null,
): Promise<TransportResponse | null> {
  if (limiter === undefined) return limiterUnavailable(context, "no rate limiter configured");
  const shop = await consume(limiter, context, `rl:${tenantId}:leads`, SHOP_LIMIT);
  if (shop !== null || visitorIp === null) return shop;
  return consume(limiter, context, `rl:${tenantId}:leads:ip:${visitorIp}`, VISITOR_LIMIT);
}

/**
 * The visitor id, click ids and UTM labels the lead keeps (P2-D8), through the same sanitiser the checkout snapshot
 * uses: a malformed id, a click id of an unknown platform, a value outside its shape or past its attribution window
 * is dropped here (it would be dead weight on the lead), never turned into a 422 that costs the shop the lead.
 */
function visitorAttributionOf(body: SubmitLeadBody): {
  readonly visitorId?: string;
  readonly clickIds?: readonly { name: string; value: string; capturedAt: string }[];
  readonly utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
    content?: string;
    term?: string;
  };
} {
  const { visitorId, clickIds, utm } = body.context;
  const kept = sanitizeAttributionSnapshot({ visitorId, clickIds, utm }, new Date());
  return {
    ...(kept?.visitorId === undefined ? {} : { visitorId: kept.visitorId }),
    ...(kept?.clickIds === undefined
      ? {}
      : {
          clickIds: kept.clickIds.map((c) => ({
            name: c.name,
            value: c.value,
            capturedAt: c.capturedAt,
          })),
        }),
    ...(kept?.utm === undefined ? {} : { utm: kept.utm }),
  };
}

function inputOf(body: SubmitLeadBody, tenantId: string, submissionKey: string) {
  const { cookies } = body.context;
  return {
    tenantId,
    submissionKey,
    formId: body.formId,
    name: body.name,
    phone: body.phone,
    ...(body.email === undefined ? {} : { email: body.email }),
    ...(body.message === undefined ? {} : { message: body.message }),
    sessionId: body.sessionId,
    sessionAlreadyEmitted: body.sessionAlreadyEmitted,
    spamSignals: body.spamSignals,
    context: {
      pageUrl: body.context.pageUrl,
      referrer: body.context.referrer,
      ip: body.context.ip,
      userAgent: body.context.userAgent,
      cookies: {
        ...(cookies.fbp === undefined ? {} : { fbp: cookies.fbp }),
        ...(cookies.fbc === undefined ? {} : { fbc: cookies.fbc }),
        ...(cookies.ttp === undefined ? {} : { ttp: cookies.ttp }),
        ...(cookies.scid === undefined ? {} : { scid: cookies.scid }),
        ...(cookies.ga === undefined ? {} : { ga: cookies.ga }),
      },
      ...visitorAttributionOf(body),
    },
  };
}

/**
 * Lead Site Part C: the lead form's anonymous submit (D2/D3). `public: true` means no guard runs, so
 * the route carries its own limits and a `.strict()` body with no tenant in it. It reaches the domain
 * through `admin.publicReads.leads` (the raw controller). `permission` is advisory, as on every
 * public route.
 */
export function publicLeadsRoutes(
  admin: WiredAdmin,
  rateLimiter?: RateLimiter,
): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/public/leads",
      version: 1,
      permission: "leads:create",
      public: true,
      // NOT `idempotent: true`: the transport snapshots every response for 24 h, transient 429/503
      // included. The Idempotency-Key header is stored on the lead (`submissionKey`) instead.
      summary:
        "Public: submit a lead-form entry (60 per 10 minutes per shop, 5 per visitor address)",
      schema: { body: submitLeadBody },
      handle: async ({ body, context }) => {
        const tenantId = context.tenantId;
        const visitorIp = body.context.ip;
        const submissionKey = submissionKeyOf(context);
        if (submissionKey === null) {
          throw new ValidationError("Invalid request header", [
            {
              field: "Idempotency-Key",
              message: "is required and must be 8-128 letters, digits or hyphens",
            },
          ]);
        }
        const refused = await refuseSubmission(rateLimiter, context, tenantId, visitorIp);
        return refused ?? admin.publicReads.leads.submit(inputOf(body, tenantId, submissionKey));
      },
    }),
  ] as readonly RouteDefinition[];
}
