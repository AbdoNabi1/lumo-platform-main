import { z } from "zod";
import { defineRoute, type RequestContext, type RouteDefinition } from "@platform/http";
import {
  MAX_BLOCKED_IPS_PER_STORE,
  isPublicIp,
  type BlockedIpEntry,
  type BlockedIpService,
} from "@platform/tracking";
import { ValidationError } from "@platform/utils";

/**
 * Tracking P1-D9: Settings → Tracking → "Excluded IP addresses". The store's own list: its office, a staff phone
 * ("exclude this device"), a known scraper. Per request tenant (never from the body: `.strict()` ⇒ 422), admin
 * level (`settings:read` / `settings:update`, like the other Settings pages). Manual only — nothing here, and
 * nothing in the platform, adds an address automatically.
 *
 * Writes are idempotent: adding a range that is already listed (in any spelling) answers 200 with the stored row
 * instead of 201, and removing an entry that is already gone answers 200 `removed: false`. An invalid address,
 * a range wider than IPv4 /16 / IPv6 /32 and an over-long note are 422 with the offending field.
 */

const MAX_CIDR_LENGTH = 64;
const MAX_NOTE = 200;

const idParams = z.object({ id: z.string().min(1).max(64) });

const addBody = z
  .object({
    /** `203.0.113.7`, `198.51.100.0/24`, `2001:db8::/32`. The service normalises and range-checks it. */
    cidr: z.string().trim().min(1).max(MAX_CIDR_LENGTH),
    note: z.string().max(MAX_NOTE).nullable().optional(),
  })
  .strict();

const excludeBody = z
  .object({
    /**
     * The address of the browser the staff member is using, when the admin web app knows it. Absent ⇒ the
     * address the runtime sees on this request (the left-most public `x-forwarded-for` hop, else the peer).
     */
    ip: z.string().trim().min(1).max(MAX_CIDR_LENGTH).optional(),
  })
  .strict();

function view(entry: BlockedIpEntry) {
  return {
    id: entry.id,
    cidr: entry.cidr,
    note: entry.note,
    createdAt: entry.createdAt,
    createdBy: entry.createdBy,
  };
}

/** The caller's address for "exclude this device": explicit, else forwarded by the web tier, else the peer. */
function deviceIpOf(explicit: string | undefined, context: RequestContext): string | undefined {
  if (explicit !== undefined) return explicit;
  const forwarded = context.headers?.["x-forwarded-for"];
  const header = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  // Left-most public hop. Spoofable by design and harmless: the caller holds `settings:update` and could add any
  // address by hand; the entry only ever affects their own store.
  const firstPublic = header
    ?.split(",")
    .map((part) => part.trim())
    .find((part) => isPublicIp(part));
  return firstPublic ?? context.ip;
}

function invalid(field: string, message: string): never {
  throw new ValidationError("Invalid request", [{ field, message }]);
}

export function blockedIpsRoutes(service: BlockedIpService): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/tracking/blocked-ips",
      version: 1,
      permission: "settings:read",
      summary: "The store's excluded IP addresses and ranges (manual list; at most 500)",
      schema: {},
      handle: async ({ context }) => {
        const items = await service.list(context.tenantId);
        return { status: 200, body: { items: items.map(view), limit: MAX_BLOCKED_IPS_PER_STORE } };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/tracking/blocked-ips",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary:
        "Exclude an IP address or range (no wider than IPv4 /16 or IPv6 /32); a repeat is 200 with the stored entry",
      schema: { body: addBody },
      handle: async ({ body, context }) => {
        const result = await service.add(context.tenantId, {
          cidr: body.cidr,
          note: body.note ?? null,
          createdBy: context.principal.id,
        });
        if (result.status === "invalid") return invalid(result.field, result.message);
        if (result.status === "limit_reached") {
          return {
            status: 409,
            body: {
              code: "LIMIT_REACHED",
              message: `A store can exclude at most ${String(result.limit)} addresses; remove one first`,
              retryable: false,
            },
          };
        }
        return {
          status: result.status === "created" ? 201 : 200,
          body: { item: view(result.entry) },
        };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/tracking/blocked-ips/exclude-this-device",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary:
        "Exclude the caller's own device: adds the address of this request (or the given `ip`) as a single host",
      schema: { body: excludeBody },
      handle: async ({ body, context }) => {
        const ip = deviceIpOf(body.ip, context);
        const result = await service.excludeDevice(context.tenantId, {
          ip,
          createdBy: context.principal.id,
        });
        if (result.status === "invalid") return invalid(result.field, result.message);
        if (result.status === "limit_reached") {
          return {
            status: 409,
            body: {
              code: "LIMIT_REACHED",
              message: `A store can exclude at most ${String(result.limit)} addresses; remove one first`,
              retryable: false,
            },
          };
        }
        return {
          status: result.status === "created" ? 201 : 200,
          body: { item: view(result.entry) },
        };
      },
    }),
    defineRoute({
      method: "DELETE",
      path: "/tracking/blocked-ips/:id",
      version: 1,
      permission: "settings:update",
      idempotent: true,
      summary:
        "Stop excluding an address; removing one that is already gone is 200 `removed: false`",
      schema: { params: idParams },
      handle: async ({ params, context }) => {
        const removed = await service.remove(context.tenantId, params.id);
        return { status: 200, body: { id: params.id, removed } };
      },
    }),
  ] as readonly RouteDefinition[];
}
