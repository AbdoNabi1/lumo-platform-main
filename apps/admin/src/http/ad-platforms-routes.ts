import { z } from "zod";
import type { RateLimiter } from "@platform/contracts";
import { defineRoute, type RouteDefinition } from "@platform/http";
import { AD_PLATFORMS } from "@platform/ad-platforms";
import {
  TEST_EVENT_CODE_PATTERN,
  type TestEventFailureCode,
  type TestEventService,
} from "@platform/tracking";
import type { WiredAdmin } from "../composition";
import { rateLimited } from "./rate-limited-response";

/** Test events per shop per minute (P2-D11). Fail-closed: a limiter that cannot answer is a 429. */
export const AD_PLATFORM_TEST_EVENT_LIMIT = 10;
export const AD_PLATFORM_TEST_EVENT_WINDOW_MS = 60 * 1000;

/**
 * Only the optional test code. No tenant, no platform (the path names it), no payload: the synthetic purchase is
 * built server side. The code is request-scoped; it is never saved by this route.
 */
const testEventBody = z
  .object({ testEventCode: z.string().regex(TEST_EVENT_CODE_PATTERN).optional() })
  .strict()
  // No body at all is the common call (the saved code is used), so an absent body is as valid as `{}`.
  .optional();

const FAILURE_STATUS: Readonly<Record<TestEventFailureCode, number>> = {
  NOT_CONNECTED: 409,
  TEST_CODE_REQUIRED: 422,
  TEST_NOT_SUPPORTED: 422,
  UNAVAILABLE: 503,
};

const platformParams = z.object({ platform: z.enum(AD_PLATFORMS) });

/**
 * No `tenantId`, no `platform` at the top level (`.strict()` ⇒ 422): the shop is the request's and the
 * platform is the path's. `secret` is write-only: accepted here, never returned. The shape rules (ids,
 * token characters) are the use case's and answer 422 field issues.
 */
const saveBody = z
  .object({
    enabled: z.boolean(),
    publicConfig: z.record(z.string(), z.unknown()).nullable(),
    secret: z.string().max(1024).optional(),
    clearSecret: z.boolean().optional(),
    testEventCode: z.string().max(64).nullable().optional(),
    /** 0 when the page loaded "no row yet". */
    expectedVersion: z.number().int().min(0),
  })
  .strict();

/**
 * Lead Site Part D1: Settings → Ad platforms. Per request tenant, admin only (`settings:*`). A token is
 * never in a response: the view carries `secret: { configured, last4 }` only. 503 `UNAVAILABLE` when a
 * token is sent while no real credential vault is configured (`AD_PLATFORM_CREDENTIALS_KEK_REF`).
 */
export function adPlatformsRoutes(
  admin: WiredAdmin,
  testEvents?: { readonly service?: TestEventService; readonly rateLimiter?: RateLimiter },
): readonly RouteDefinition[] {
  const testBudget = async (tenantId: string) => {
    const limiter = testEvents?.rateLimiter;
    const unavailable = () =>
      rateLimited(60_000, "Test events are unavailable right now. Try again in a minute.");
    if (limiter === undefined) return unavailable();
    try {
      const decision = await limiter.consume(
        `rl:${tenantId}:ad-platform-test-event`,
        AD_PLATFORM_TEST_EVENT_LIMIT,
        AD_PLATFORM_TEST_EVENT_WINDOW_MS,
      );
      return decision.allowed
        ? null
        : rateLimited(
            decision.retryAfterMs,
            "You've sent a lot of test events. Try again in a minute.",
          );
    } catch {
      return unavailable();
    }
  };

  return [
    defineRoute({
      method: "GET",
      path: "/ad-platforms",
      version: 1,
      permission: "settings:read",
      summary:
        "The shop's five ad platform connections (tokens are never returned: configured + last4)",
      schema: {},
      handle: async ({ context }) => {
        const res = await admin.adPlatforms.list(context.principal, { tenantId: context.tenantId });
        // The use case answers a bare array; the contract is `{ items }`.
        return res.status === 200 ? { ...res, body: { items: res.body } } : res;
      },
    }),
    defineRoute({
      method: "PUT",
      path: "/ad-platforms/:platform",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary:
        "Save one platform's connection: public ids, enabled, an optional write-only token (409 when stale)",
      schema: { params: platformParams, body: saveBody },
      handle: ({ params, body, context }) =>
        admin.adPlatforms.save(context.principal, {
          tenantId: context.tenantId,
          platform: params.platform,
          enabled: body.enabled,
          // The path names the platform; a body that names another one fails validation (422).
          publicConfig:
            body.publicConfig === null ? null : { platform: params.platform, ...body.publicConfig },
          ...(body.secret === undefined ? {} : { secret: body.secret }),
          ...(body.clearSecret === undefined ? {} : { clearSecret: body.clearSecret }),
          ...(body?.testEventCode === undefined ? {} : { testEventCode: body.testEventCode }),
          expectedVersion: body.expectedVersion,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/ad-platforms/:platform/test-event",
      version: 1,
      permission: "settings:update",
      summary:
        "Send one synthetic purchase (test_<uuid>) to a platform to see it in Events Manager; never recorded",
      schema: { params: platformParams, body: testEventBody },
      handle: async ({ params, body, context }) => {
        const service = testEvents?.service;
        if (service === undefined) {
          return {
            status: 503,
            body: {
              code: "NOT_CONFIGURED",
              message: "Test events are not available yet.",
              retryable: false,
              fields: [],
            },
          };
        }
        const limited = await testBudget(context.tenantId);
        if (limited !== null) return limited;
        const outcome = await service.send({
          tenantId: context.tenantId,
          platform: params.platform,
          ...(body?.testEventCode === undefined ? {} : { testEventCode: body.testEventCode }),
        });
        if (outcome.ok) return { status: 200, body: outcome.result };
        return {
          status: FAILURE_STATUS[outcome.code],
          body: { code: outcome.code, message: outcome.message, retryable: false, fields: [] },
        };
      },
    }),
  ] as readonly RouteDefinition[];
}
