import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

const identifierType = z.enum([
  "visitor_id",
  "client_id",
  "browser_id",
  "device_id",
  "session_id",
  "email_hash",
  "phone_hash",
  "customer_id",
  "external_id",
  "crm_id",
  "loyalty_id",
  "household_id",
]);
const identifierParams = z.object({ identifierType, identifierValue: z.string().min(1) });
const profileQuery = z.object({
  expectedFields: z.array(z.string()).optional(),
});
const visitorParams = z.object({ visitorId: z.string().min(1) });

/** The Customer 360 admin HTTP surface (Sprint S1) — the read-only Profile/Identity/Journey side. */
export function customer360Routes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/customer-360/profile/:identifierType/:identifierValue",
      version: 1,
      permission: "customer360:read",
      summary: "Get the merged customer profile for an identifier",
      schema: { params: identifierParams, querystring: profileQuery },
      handle: ({ params, query, context }) =>
        admin.customer360.getProfile(context.principal, { ...params, ...query }),
    }),
    defineRoute({
      method: "GET",
      path: "/customer-360/identity-timeline/:identifierType/:identifierValue",
      version: 1,
      permission: "customer360:read",
      summary: "Get the identity-resolution timeline for an identifier",
      schema: { params: identifierParams },
      handle: ({ params, context }) =>
        admin.customer360.getIdentityTimeline(context.principal, params),
    }),
    defineRoute({
      method: "GET",
      path: "/customer-360/journeys/:visitorId/timeline",
      version: 1,
      permission: "customer360:read",
      summary: "Get a visitor's session journey timeline",
      schema: { params: visitorParams },
      handle: ({ params, context }) =>
        admin.customer360.getJourneyTimeline(context.principal, params),
    }),
    defineRoute({
      method: "GET",
      path: "/customer-360/journeys/:visitorId/state",
      version: 1,
      permission: "customer360:read",
      summary: "Get a visitor's current journey state",
      schema: { params: visitorParams },
      handle: ({ params, context }) => admin.customer360.getJourneyState(context.principal, params),
    }),
  ] as readonly RouteDefinition[];
}
