import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import { LEAD_STATUSES, type LeadView } from "@platform/leads";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const leadIdParams = z.object({ leadId: z.string().min(1).max(64) });
const pageQuery = z.object({
  first: z.coerce.number().int().positive().max(100).optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});
const leadListQuery = pageQuery.extend({
  status: z.enum(LEAD_STATUSES).optional(),
  search: z.string().max(100).optional(),
});
const changeStatusBody = z.object({ status: z.enum(LEAD_STATUSES) }).strict();
const exportRowsQuery = z.object({
  after: z.string().optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
});

export type LeadDto = LeadView;

/** Explicit primitives, 1:1 with the use case's view: nothing added by a later field leaks out unseen. */
function toLeadDto(lead: LeadView): LeadDto {
  return {
    id: lead.id,
    formId: lead.formId,
    name: lead.name,
    phone: lead.phone,
    phoneE164: lead.phoneE164,
    email: lead.email,
    message: lead.message,
    status: lead.status,
    trackingStatus: lead.trackingStatus,
    eventId: lead.eventId,
    createdAt: lead.createdAt,
    pageUrl: lead.pageUrl,
    referrer: lead.referrer,
  };
}

/** The Leads inbox admin surface (Lead Site Part C). The tenant is always the request's. */
export function leadsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/leads",
      version: 1,
      permission: "leads:read",
      summary: "List leads (cursor pagination, status filter, search by name/phone/email)",
      schema: { querystring: leadListQuery },
      handle: async ({ query, context }) =>
        mapPage(
          await admin.leads.list(context.principal, {
            tenantId: context.tenantId,
            ...(query.first === undefined ? {} : { first: query.first }),
            ...(query.after === undefined ? {} : { after: query.after }),
            ...(query.status === undefined ? {} : { status: query.status }),
            ...(query.search === undefined ? {} : { search: query.search }),
          }),
          toLeadDto,
        ),
    }),
    // Registered before `/leads/:leadId` so the literal segment is never read as an id.
    defineRoute({
      method: "GET",
      path: "/leads/export-rows",
      version: 1,
      permission: "leads:export",
      summary: "Lead rows for the CSV export (cursor pages of 250)",
      schema: { querystring: exportRowsQuery },
      handle: async ({ query, context }) =>
        mapPage(
          await admin.leads.exportRows(context.principal, {
            tenantId: context.tenantId,
            ...(query.after === undefined ? {} : { after: query.after }),
            ...(query.status === undefined ? {} : { status: query.status }),
            ...(query.createdFrom === undefined ? {} : { createdFrom: query.createdFrom }),
            ...(query.createdTo === undefined ? {} : { createdTo: query.createdTo }),
          }),
          toLeadDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/leads/:leadId",
      version: 1,
      permission: "leads:read",
      summary: "Get one lead",
      schema: { params: leadIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.leads.get(context.principal, {
          tenantId: context.tenantId,
          leadId: params.leadId,
        });
        return response.status === 200
          ? { ...response, body: toLeadDto(response.body as LeadView) }
          : response;
      },
    }),
    defineRoute({
      method: "POST",
      path: "/leads/:leadId/status",
      version: 1,
      permission: "leads:update",
      idempotent: true,
      summary: "Move a lead to any status (the same status again is a no-op)",
      schema: { params: leadIdParams, body: changeStatusBody },
      handle: async ({ params, body, context }) => {
        const response = await admin.leads.changeStatus(context.principal, {
          tenantId: context.tenantId,
          leadId: params.leadId,
          status: body.status,
        });
        return response.status === 200
          ? { ...response, body: toLeadDto(response.body as LeadView) }
          : response;
      },
    }),
  ] as readonly RouteDefinition[];
}
