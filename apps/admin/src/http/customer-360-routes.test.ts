import { describe, expect, it, vi } from "vitest";
import type { WiredAdmin } from "../composition";
import { customer360Routes } from "./customer-360-routes";

/**
 * ADR-0014 (WP-10, T10.3): every Customer 360 admin route sources its tenant from the verified
 * request context (`context.tenantId`), never from a caller-supplied field. Each case hands the route
 * a params/query that carries a hostile `tenantId` and asserts the controller still receives the
 * context's.
 */
const CONTEXT_TENANT = "tenant-from-verified-context";

function invoke(
  admin: WiredAdmin,
  path: string,
  request: { readonly params: unknown; readonly query?: unknown },
): Promise<unknown> {
  const route = customer360Routes(admin).find((r) => r.path === path);
  if (route === undefined) throw new Error(`no customer-360 route at ${path}`);
  return Promise.resolve(
    route.handle({
      body: undefined,
      params: request.params,
      query: request.query ?? {},
      context: {
        tenantId: CONTEXT_TENANT,
        principal: { id: "staff-1", kind: "staff", roles: ["admin"] },
        requestId: "req-1",
      },
    } as never),
  );
}

describe("customer-360 routes — tenant comes from the verified request context", () => {
  it.each([
    [
      "/customer-360/profile/:identifierType/:identifierValue",
      "getProfile",
      { identifierType: "customer_id", identifierValue: "c-1", tenantId: "evil-params" },
      { tenantId: "evil-query" },
    ],
    [
      "/customer-360/identity-timeline/:identifierType/:identifierValue",
      "getIdentityTimeline",
      { identifierType: "customer_id", identifierValue: "c-1", tenantId: "evil-params" },
      undefined,
    ],
    [
      "/customer-360/journeys/:visitorId/timeline",
      "getJourneyTimeline",
      { visitorId: "v-1", tenantId: "evil-params" },
      undefined,
    ],
    [
      "/customer-360/journeys/:visitorId/state",
      "getJourneyState",
      { visitorId: "v-1", tenantId: "evil-params" },
      undefined,
    ],
  ])("%s passes context.tenantId to the controller", async (path, method, params, query) => {
    const handler = vi.fn(async () => ({ status: 200, body: {} }));
    const admin = { customer360: { [method]: handler } } as unknown as WiredAdmin;

    await invoke(admin, path, { params, query });

    expect(handler).toHaveBeenCalledTimes(1);
    const input = (handler.mock.calls[0] as unknown as [unknown, { tenantId: string }])[1];
    expect(input.tenantId).toBe(CONTEXT_TENANT);
  });
});
