import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

/** The domain is always derived server-side from the store's sender email: no field to steer it. */
const noBody = z.object({}).strict();

/**
 * Wave 2b (D43): authenticate the store's own sending domain. Per request tenant. 503 NOT_CONFIGURED
 * while the runtime has no `RESEND_DOMAINS_API_KEY`; provider failures answer 502 with a plain message.
 */
export function senderDomainRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/notifications/sender-domain",
      version: 1,
      permission: "settings:read",
      summary: "The store's sending domain, its DNS records and status (no provider call)",
      schema: {},
      handle: ({ context }) =>
        admin.senderDomain.get(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/notifications/sender-domain",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary:
        "Authenticate the sender email's domain: create it at the email provider, show DNS records",
      schema: { body: noBody },
      handle: ({ context }) =>
        admin.senderDomain.start(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/notifications/sender-domain/verify",
      version: 1,
      permission: "settings:update",
      summary: "Ask the email provider to check the DNS records and store the status",
      schema: { body: noBody },
      handle: ({ context }) =>
        admin.senderDomain.verify(context.principal, { tenantId: context.tenantId }),
    }),
  ] as readonly RouteDefinition[];
}
