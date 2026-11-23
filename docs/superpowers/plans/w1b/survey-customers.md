# Wave 1b customer survey

Worktree HEAD `a8a8bf62ff5e90ee2d2778f6469c3f66f797b07a`. Paths relative to worktree. Static inspection only; tests not run. NOT FOUND means not found in inspected source.

## 1. Aggregate

Identity owns `Customer`: `email: Email` (readonly), `name`, `addresses`, `consents`, `isGuest`, `emailVerifiedAt`, inherited id/version (`services/identity/src/domain/customer.ts:10-30`). `register(id,email,name,eventId,occurredAt)` and `registerGuest(...)` initialize empty addresses/consents and raise registered; `reconstitute(id,email,name,addresses,consents,version,isGuest=false,emailVerifiedAt=null)` emits nothing (`services/identity/src/domain/customer.ts:31-97`). Email is required, trimmed, lowercased and regex validated (`services/identity/src/domain/value-objects/email.ts:8-21`); name nonempty and email unique per tenant (`services/identity/src/application/register-customer.use-case.ts:40-63`; `packages/db/prisma/schema/identity.prisma:5-20`). Guest resolution returns existing without modification or creates guest, with conflict race recovery in a fresh UoW (`services/identity/src/application/resolve-guest-customer.use-case.ts:31-49,62-105`). Phone field, phone normalization and uniqueness: NOT FOUND. Mutations are `addAddress`, `upgradeFromGuest` (guest only; name and verified timestamp; no event), `changeConsent` (append and event), `consentFor` (latest or false); general edit methods NOT FOUND (`services/identity/src/domain/customer.ts:99-145`).

## 2. Prisma and tenant

- `Customer` maps `identity.customers`: `id` UUID PK, `tenantId` -> `tenant_id`, `email`, `name`, `isGuest` -> `is_guest`, `emailVerifiedAt` -> `email_verified_at`, `version`, `createdAt` -> `created_at`, `updatedAt` -> `updated_at`, `deletedAt` -> `deleted_at`; relations `addresses`, `consents`; `@@unique([tenantId,email])` (`packages/db/prisma/schema/identity.prisma:5-22`). Unique includes soft-deleted rows; read excludes them (`services/identity/src/infrastructure/prisma-customer-repository.ts:108-120`).
- `Address` -> `identity.addresses`: `id` UUID PK, `tenantId`, `customerId`, `line1`, `city`, `postalCode`, `country`, `createdAt`; customer FK cascade and `@@index([customerId])` (`packages/db/prisma/schema/identity.prisma:42-56`).
- `ConsentRecord` -> `identity.consent_records`: `id` UUID PK, `tenantId`, `customerId`, `scope`, `granted`, `occurredAt`; customer FK cascade, `@@index([customerId,scope,occurredAt])`, append-only (`packages/db/prisma/schema/identity.prisma:59-72`). All carry `tenant_id`; general migration enables and forces tenant isolation on tenant_id business tables (`packages/db/prisma/MIGRATIONS.md:27-43`); deployed policy state unverified.
- Customer phone, language, note, tags/table NOT FOUND in identity model (`packages/db/prisma/schema/identity.prisma:5-23,42-72`). Closest precedent `Order.note` and `OrderTag {tenantId,orderId,tag,tagKey,createdAt}`, PK `(orderId,tagKey)`, index `(tenantId,tagKey)` (`packages/db/prisma/schema/orders.prisma:19-26,91-106`). Consent history exists but no separate channel.

## 3. Port, adapters, wiring

Exact port (`services/identity/src/domain/customer-repository.ts:4-7,31-38,44-53`):

```ts
export interface CustomerListQuery extends CursorPage {
  readonly search?: string;
}
save(customer: Customer, tenantId: string, tx?: unknown): Promise<void>;
findById(id: string, tenantId: string, tx?: unknown): Promise<Customer | null>;
findByEmail(email: string, tenantId: string, tx?: unknown): Promise<Customer | null>;
list(query: CustomerListQuery, tenantId: string, tx?: unknown): Promise<Paginated<Customer>>;
findContactsByIds(ids: readonly string[], tenantId: string, tx?: unknown): Promise<readonly CustomerContact[]>;
```

Last method is on separate `CustomerContactReader`. Prisma and in-memory implement both (`services/identity/src/infrastructure/prisma-customer-repository.ts:44-92,108-124,155-159`; `services/identity/src/infrastructure/in-memory-customer-repository.ts:39-84`). Prisma save requires transaction, version-checks, inserts addresses/consents with skipDuplicates and writes outbox atomically; update writes only name/isGuest/emailVerifiedAt, not email, and unique conflict translated only on create (`prisma-customer-repository.ts:44-89,197-200`). Memory enforces tenant email uniqueness (`in-memory-customer-repository.ts:39-51`). Prisma list searches name/email case-insensitively, descending id cursor, tenant scope, excluding deleted (`prisma-customer-repository.ts:150-194`). `apps/admin/src/composition.ts:1056,1423` calls `wireIdentity(deps)` then wraps in guarded admin controller; `services/identity/src/composition.ts:85-131,186-210,215-233` builds use cases and Prisma/UoW or memory/UoW with outbox.

## 4. Existing use case inputs verbatim

```ts
// services/identity/src/application/list-customers.use-case.ts:8
export type ListCustomersInput = CustomerListQuery & { readonly tenantId: string };
// services/identity/src/application/get-customer.use-case.ts:7-10
export interface GetCustomerInput {
  readonly customerId: string;
  readonly tenantId: string;
}
// services/identity/src/application/register-customer.use-case.ts:11-15
export interface RegisterCustomerInput {
  readonly email: string;
  readonly name: string;
  readonly tenantId: string;
}
// services/identity/src/application/resolve-guest-customer.use-case.ts:11-16
export interface ResolveGuestCustomerInput {
  readonly email: string;
  readonly name: string;
  /** ADR-0014: the tenant the checkout session belongs to. The same email in two tenants is two customers. */
  readonly tenantId: string;
}
// services/identity/src/application/get-customer-contacts.use-case.ts:6-9
export interface GetCustomerContactsInput {
  readonly tenantId: string;
  readonly customerIds: readonly string[];
}
// services/identity/src/application/change-consent.use-case.ts:10-15
export interface ChangeConsentInput {
  readonly customerId: string;
  readonly scope: string;
  readonly granted: boolean;
  readonly tenantId: string;
}
// services/identity/src/application/add-address.use-case.ts:10-17
export interface AddAddressInput {
  readonly customerId: string;
  readonly line1: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
  readonly tenantId: string;
}
// services/identity/src/application/request-signup-link.use-case.ts:13-16
export interface RequestSignupLinkInput {
  readonly email: string;
  readonly tenantId: string;
}
// services/identity/src/application/complete-signup.use-case.ts:11-15
export interface CompleteSignupInput {
  readonly token: string;
  readonly name: string;
  readonly tenantId: string;
}
```

List/contacts return ok; get returns NOT_FOUND; register returns VALIDATION/CONFLICT; guest validates and recovers conflict; consent validates scope and returns NOT_FOUND; address validates and returns NOT_FOUND; signup request validates email; completion validates name and returns NOT_FOUND for invalid token (`services/identity/src/application/list-customers.use-case.ts:26-27`, `services/identity/src/application/get-customer-contacts.use-case.ts:31-36`, `services/identity/src/application/get-customer.use-case.ts:24-29`, `services/identity/src/application/register-customer.use-case.ts:40-63`, `services/identity/src/application/resolve-guest-customer.use-case.ts:62-105`, `services/identity/src/application/change-consent.use-case.ts:42-59`, `services/identity/src/application/add-address.use-case.ts:35-52`, `services/identity/src/application/request-signup-link.use-case.ts:58-75`, `services/identity/src/application/complete-signup.use-case.ts:31,50-85`). Persistence may throw CONFLICT/CONCURRENCY rather than return Result (`services/identity/src/infrastructure/prisma-customer-repository.ts:48-73`). Presenter maps VALIDATION 422, NOT_FOUND 404, CONFLICT/CONCURRENCY/BUSINESS_RULE 409, UNAUTHENTICATED 401, FORBIDDEN 403, fallback 422 (`services/identity/src/interfaces/presenter.ts:9-27`); success register/address 201, others 200 (`services/identity/src/interfaces/customer.controller.ts:44-81`). Presenter maps Results, not necessarily thrown exceptions.

## 5. Admin HTTP

`GET /api/v1/customers` requires `customers:read`, accepts `first` optional int 1..100, `after` optional nonempty cursor, `search` optional nonempty; tenant from verified context (`apps/admin/src/http/admin-routes.ts:186-191,1692-1708`). Page `{items:[{id,name,email}],pageInfo:{hasNextPage,endCursor}}` (`apps/admin/src/http/admin-routes.ts:501-509`; `apps/admin-web/src/lib/api/customers.ts:4-17`). `GET /api/v1/customers/:customerId`, `customers:read`, returns `{id,name,email,addresses:[{line1,city,postalCode,country}],consents:[{scope,granted,occurredAt}]}` (`apps/admin/src/http/admin-routes.ts:467-499,1710-1727`). Customer POST/PATCH/consent HTTP route NOT FOUND. Internal guarded methods exist for registration `customers:register`, address `customers:add_address`, consent `customers:change_consent` (`apps/admin/src/interfaces/customers.admin-controller.ts:26-50`).

## 6. Permissions

`customers` is a shop resource (`packages/auth/src/role-table-access-control.ts:3-17`); actual rows (`packages/auth/src/role-table-access-control.ts:40-50`):

```ts
admin: ["*:*"],
operator: [
  ...SHOP_RESOURCES.map((r) => `${r}:*`),
  ...READ_ONLY_RESOURCES.map((r) => `${r}:read`),
  "account:update_self",
],
viewer: [
  ...[...SHOP_RESOURCES, ...READ_ONLY_RESOURCES].map((r) => `${r}:read`),
  "account:update_self",
],
```

Literal `customers:write`/`customers:update` rows NOT FOUND. Wildcards grant both to admin/operator, not viewer (`packages/auth/src/role-table-access-control.ts:61-66,74-85`).

## 7. Marketing consent

Identity append-only ConsentRecord is source of truth; allowed scopes `marketing`, `analytics`, `data_sharing`, no email/SMS distinction (`packages/db/prisma/schema/identity.prisma:59-72`; `services/identity/src/domain/value-objects/consent-scope.ts:4-22`). Current consent is latest record, default false (`services/identity/src/domain/customer.ts:120-145`). Log has no source, actor, channel or proof (`packages/db/prisma/schema/identity.prisma:60-68`). Security `SecurityConsentProjection` is LWW copy keyed tenant/subject/purpose, not source (`packages/db/prisma/schema/security.prisma:336-354`); event consumer `services/security/src/interfaces/consent-changed.consumer.ts:11-36`. Customer 360 profile cache is separate (`packages/db/prisma/schema/customer-360.prisma:65-75`). Storefront writer for customer marketing consent or newsletter persistence NOT FOUND in storefront and online-store source searches. Guest checkout explicitly creates no opt-in (`services/identity/src/application/resolve-guest-customer.use-case.ts:31-39`).

## 8. Admin web

List page `apps/admin-web/src/app/customers/page.tsx:7-10,27-39,95-103`, toolbar search `apps/admin-web/src/components/customers/customers-toolbar.tsx:15,59-65`, name/email table `apps/admin-web/src/components/customers/customers-table.tsx:22-52`, cursor pagination `apps/admin-web/src/components/customers/customers-pagination.tsx:9-13`. Detail `apps/admin-web/src/app/customers/[customerId]/page.tsx:8-17,36-48,57-64,131-137` includes orders, addresses, consent, 360 profile and identity timeline; consent card derives latest scope (`apps/admin-web/src/components/customers/customer-consent-card.tsx:8-23`). API `fetchCustomersPage({first?,after?,search?})`, `fetchCustomer(customerId)` (`apps/admin-web/src/lib/api/customers.ts:28-52,65-76,94-107`). Customer `actions.ts`, create page, edit forms, export UI NOT FOUND under customer pages/components inspected. Message groups `customersPage`, `customerDetail` in English and Arabic (`apps/admin-web/src/messages/en.ts:1506,1522`; `apps/admin-web/src/messages/ar.ts:1424,1440`).

## 9. CSV precedent

Admin `GET /api/v1/orders/export-rows`, `orders:export`, returns paged JSON up to 250, not streamed job (`apps/admin/src/http/order-operations-routes.ts:171-185,201-205`). Native GET form targets admin-web `/orders/export` (`apps/admin-web/src/components/orders/orders-export-dialog.tsx:31,79`); route collects pages, builds whole CSV in memory, returns attachment `text/csv`, redirects on failure (`apps/admin-web/src/app/orders/export/route.ts:13-19,31-41`). Cap 5000, 250/page, 60 requests (`apps/admin-web/src/lib/orders/orders-export.ts:10-14,81-103`). CSV helper uses BOM/CRLF, escaping and formula injection guard with phone-shaped exception (`apps/admin-web/src/lib/orders/orders-csv.ts:37-57,86-125`). Customer CSV helper/route NOT FOUND.

## 10. Events

Registration and guest-create emit `customer.registered`; consent changes emit `consent.changed`; address addition and guest upgrade emit no events (`services/identity/src/domain/customer.ts:64-73,99-109,120-133`). Translator maps to `identity.customer.registered` and `identity.customer.consent_changed`; in-memory topic names use `.v1` (`services/identity/src/infrastructure/identity-event-translator.ts:14-15,35-43`; `services/identity/src/composition.ts:240-241`). Outbox is same transaction (`services/identity/src/infrastructure/prisma-customer-repository.ts:76-89`). Security projection consumer depends on consent event and tenant (`services/security/src/interfaces/consent-changed.consumer.ts:27-36,48-59`). Customer-update event/consumer NOT FOUND; do not assume 360 updates automatically on email changes.

## 11. Proposed design and risks

- Add `CreateCustomer`, `UpdateCustomer`, `SetCustomerTags`, `SetCustomerNote`, `ChangeCustomerMarketingConsent`, `ListCustomerExportRows`; alternatively reuse `RegisterCustomer`/`ChangeConsent` behind explicit orchestration, but keep create and requested fields/consent atomic. Add domain mutation methods. Existing `save`/`findById`/`findByEmail` support core writes; add `listExportRows(query,tenantId,tx?)` for narrow cursor projection and, for separate tags, `replaceTags(customerId,tags,tenantId,tx?)` and `findTagsByCustomerIds(ids,tenantId,tx?)`. All per-tenant, transactional, avoid N+1 (ports `services/identity/src/domain/customer-repository.ts:31-53`; adapter `services/identity/src/infrastructure/prisma-customer-repository.ts:44-89,150-194`).
- Migration needed for this design: add nullable `identity.customers.phone`, `language`, `note`; new `identity.customer_tags(tenant_id,customer_id UUID,tag,tag_key,created_at)` with PK `(customer_id,tag_key)`, index `(tenant_id,tag_key)`, FK customer, ENABLE/FORCE RLS. For attribution add nullable `actor_ref`, `source` to `identity.consent_records`. Prefer extending scopes to `marketing_email` and `marketing_sms` over untracked booleans; preserve existing `marketing` and history. Decide legacy generic mapping explicitly; never infer two channel opt-ins. Security consumer compatibility must be tested (`services/identity/src/domain/value-objects/consent-scope.ts:4-22`; `packages/db/prisma/schema/security.prisma:336-354`). Optional-email/phone-only parity needs additional redesign of non-null email, uniqueness, auth and downstream DTOs; phone uniqueness requires product decision (`packages/db/prisma/schema/identity.prisma:5-20`; `services/identity/src/domain/customer.ts:10-14`).
- Proposed v1 routes, tenant from context: `POST /customers` `{name,email,phone?,language?,tags?,note?,marketingEmail?,marketingSms?}` permission `customers:register`; `PATCH /customers/:customerId` partial `{name,email,phone,language}` permission `customers:update`; `PUT /customers/:customerId/tags` `{tags:string[]}` permission `customers:update`; `PUT /customers/:customerId/note` `{note:string|null}` permission `customers:update`; `PUT /customers/:customerId/marketing-consent` `{email?:boolean,sms?:boolean}` permission `customers:change_consent`; `GET /customers/export-rows?first=&after=&search=` permission `customers:export`, paged JSON consumed by admin-web `/customers/export` attachment. Guard route and controller, register static route ahead of param route. Distinct export permission parallels orders (`apps/admin/src/http/order-operations-routes.ts:171-176`; `packages/auth/src/role-table-access-control.ts:40-49`).
- Touch `packages/db/prisma/schema/identity.prisma`, additive migration, Identity domain/value objects/events/repository/mapper/both adapters/use cases/controller/composition/index and tests, Security consent consumer/projection tests if needed, `apps/admin/src/interfaces/customers.admin-controller.ts`, `apps/admin/src/http/admin-routes.ts` and tests, admin-web customer pages/components, `lib/api/customers.ts`, new actions/export route/CSV helper, en/ar messages. Existing wiring `services/identity/src/composition.ts:85-131,186-233`; admin `apps/admin/src/composition.ts:1056,1423`.
- Risks: consent provenance/legal authorization and channel compatibility; email edits must persist, normalize, handle update-side unique violation and reset verification and review signup tokens/credentials; preserve guest ids, order links, events and security projection; decide whether 360 needs new update event; uniqueness against soft-deleted email differs from lookup; enforce tenant FK/RLS; version conflicts and atomic tag/consent changes; export PII authorization, formula injection, BOM/Arabic, bounded pagination/consistency and no partial download. Evidence `services/identity/src/infrastructure/prisma-customer-repository.ts:48-74,108-120`; `services/identity/src/domain/customer.ts:103-109`; `apps/admin-web/src/lib/orders/orders-csv.ts:37-57`; `apps/admin-web/src/lib/orders/orders-export.ts:81-103`.
