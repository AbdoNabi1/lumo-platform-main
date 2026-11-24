import { z } from "zod";
import type { Principal } from "@platform/contracts";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { Customer } from "@platform/identity";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import type { CustomerExportPage } from "../interfaces/customers.admin-controller";

const customerIdParams = z.object({ customerId: z.string().min(1) });

// Transport schemas check STRUCTURE only (types, unknown keys, body-size bounds). The identity
// application is the authority for every semantic limit — name 1..255 code points, phone digits,
// note 5000, tag length 40 and 250 tags counted after comma splitting — and answers 422
// `VALIDATION` with the failing field names (Wave 1b plan review 1 finding 7, review 2 finding R7).
const language = z.enum(["en", "ar"]);
const createCustomerBody = z
  .object({
    name: z.string().max(1000),
    email: z.string().max(320),
    phone: z.string().max(64).optional(),
    language: language.optional(),
    note: z.string().max(20_000).optional(),
    tags: z.array(z.string()).optional(),
    marketingEmail: z.boolean().optional(),
    marketingSms: z.boolean().optional(),
  })
  .strict();
// No refine: the use case reports an empty body as field `body`.
const profileBody = z
  .object({
    name: z.string().max(1000).optional(),
    phone: z.string().max(64).nullable().optional(),
    language: language.nullable().optional(),
  })
  .strict();
const noteBody = z.object({ note: z.string().max(20_000).nullable() }).strict();
const tagsBody = z.object({ tags: z.array(z.string()) }).strict();
const consentBody = z
  .object({ email: z.boolean().optional(), sms: z.boolean().optional() })
  .strict();
const exportRowsQuery = z.object({
  first: z.coerce.number().int().min(1).max(100).default(100),
  after: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
});

/** Current marketing state per channel, derived from the latest record of each scope (default: off). */
export function marketingOf(customer: Customer): { email: boolean; sms: boolean } {
  const latest = (scope: string): boolean => {
    for (let i = customer.consents.length - 1; i >= 0; i -= 1) {
      const record = customer.consents[i];
      if (record !== undefined && record.scope.value === scope) return record.granted;
    }
    return false;
  };
  return { email: latest("marketing"), sms: latest("marketing_sms") };
}

/** The note and tags of one customer, or the error response of a failed read (never partial data). */
export async function annotationsOfCustomer(
  admin: WiredAdmin,
  principal: Principal,
  tenantId: string,
  customerId: string,
): Promise<
  | { readonly ok: true; readonly note: string | null; readonly tags: readonly string[] }
  | { readonly ok: false; readonly response: AdminResponse }
> {
  const response = await admin.customers.customerAnnotations(principal, {
    tenantId,
    customerIds: [customerId],
  });
  if (response.status !== 200) return { ok: false, response };
  const item = (
    response.body as {
      items: readonly { customerId: string; note: string | null; tags: readonly string[] }[];
    }
  ).items[0];
  return { ok: true, note: item?.note ?? null, tags: item?.tags ?? [] };
}

/** One CSV-ready row: flat primitives only (Customer is an Entity — never passed through). */
export interface CustomerExportRowDto {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly language: "en" | "ar" | null;
  readonly emailMarketing: boolean;
  readonly smsMarketing: boolean;
  readonly tags: readonly string[];
  readonly note: string | null;
  readonly isGuest: boolean;
  /** The first address on file, or `null`. */
  readonly address: {
    readonly line1: string;
    readonly city: string;
    readonly postalCode: string;
    readonly country: string;
  } | null;
}

export function toCustomerExportRowDto(
  customer: Customer,
  note: string | null,
  tags: readonly string[],
): CustomerExportRowDto {
  const marketing = marketingOf(customer);
  const first = customer.addresses[0];
  return {
    id: customer.id.toString(),
    name: customer.name,
    email: customer.email.value,
    phone: customer.phone,
    language: customer.language,
    emailMarketing: marketing.email,
    smsMarketing: marketing.sms,
    tags,
    note,
    isGuest: customer.isGuest,
    address:
      first === undefined
        ? null
        : {
            line1: first.line1,
            city: first.city,
            postalCode: first.postalCode,
            country: first.country,
          },
  };
}

/**
 * Wave 1b — staff-side customer writes and the export read. Spread IMMEDIATELY BEFORE the existing
 * `GET /customers` in `admin-routes.ts`, so `GET /customers/export-rows` is registered before
 * `GET /customers/:customerId`. The tenant always comes from the verified context.
 */
export function customerRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/customers",
      version: 1,
      permission: "customers:register",
      idempotent: true,
      summary: "Create a customer with profile, marketing assertions, note and tags",
      schema: { body: createCustomerBody },
      handle: ({ body, context }) =>
        admin.customers.createCustomer(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "GET",
      path: "/customers/export-rows",
      version: 1,
      permission: "customers:export",
      summary: "One page of customers with notes and tags for the CSV export (cursor-paginated)",
      schema: { querystring: exportRowsQuery },
      handle: async ({ query, context }): Promise<AdminResponse> => {
        const response = await admin.customers.exportCustomers(context.principal, {
          ...query,
          tenantId: context.tenantId,
        });
        if (response.status !== 200) return response;
        const page = response.body as CustomerExportPage;
        return {
          status: 200,
          body: {
            items: page.items.map((item) =>
              toCustomerExportRowDto(item.customer, item.note, item.tags),
            ),
            pageInfo: page.pageInfo,
          },
        };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/customers/:customerId",
      version: 1,
      permission: "customers:update",
      idempotent: true,
      summary: "Change a customer's name, phone and/or language (only the keys present)",
      schema: { params: customerIdParams, body: profileBody },
      handle: ({ params, body, context }) =>
        admin.customers.updateCustomerProfile(context.principal, {
          ...body,
          customerId: params.customerId,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/customers/:customerId/note",
      version: 1,
      permission: "customers:update",
      idempotent: true,
      summary: "Set or clear a customer's staff note (never bumps the customer's version)",
      schema: { params: customerIdParams, body: noteBody },
      handle: ({ params, body, context }) =>
        admin.customers.setCustomerNote(context.principal, {
          customerId: params.customerId,
          note: body.note,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/customers/:customerId/tags",
      version: 1,
      permission: "customers:update",
      idempotent: true,
      summary: "Replace a customer's whole tag set (case-insensitive, at most 250)",
      schema: { params: customerIdParams, body: tagsBody },
      handle: ({ params, body, context }) =>
        admin.customers.setCustomerTags(context.principal, {
          customerId: params.customerId,
          tags: body.tags,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/customers/:customerId/marketing-consent",
      version: 1,
      permission: "customers:change_consent",
      idempotent: true,
      summary: "Record the staff-asserted email and/or SMS marketing choice of a customer",
      schema: { params: customerIdParams, body: consentBody },
      handle: ({ params, body, context }) =>
        admin.customers.changeMarketingConsent(context.principal, {
          ...body,
          customerId: params.customerId,
          tenantId: context.tenantId,
        }),
    }),
  ];
}
