# Shopify parity — Wave 1b outline (pre-plan discovery, Opus)

Status: outline only. The full plan is written after Wave 1a clears Sol, so it can reuse 1a's conventions.
Base: 6beb346c.

## Findings (verified in the worktree)

| Area                | Backend today                                                                                                                                                                                                                                                                    | Gap to Shopify                                                                                                                                                                                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files page          | `apps/admin/src/http/media-library-routes.ts`: folders (list/create/rename/archive), assets (list/get/update/archive/download-url), `POST /media/uploads`                                                                                                                        | UI only: `/content/files` page (grid/list, upload, folders, search, archive). Cheapest item.                                                                                                                                                                                                                     |
| Customers write     | Admin API has only `GET /customers`, `GET /customers/:id` (`admin-routes.ts` ~1693). Identity use cases: get/list/register/resolve-guest only                                                                                                                                    | Needs new use cases + routes: create (admin), update name/phone/language, tags, note, marketing consent edit, CSV export. Import later. Touches `services/identity` → backend task.                                                                                                                              |
| Segments            | `services/customer-360` has create/update/delete/members/evaluate use cases on a generic `@platform/rules` `RuleSet<boolean>` over customer-360 attributes; **not wired into apps/admin composition**; no list use case; only 4 read routes under `/customer-360/*`              | Shopify segments filter customer fields (orders count, amount spent, last order date, email subscription, location, tags). Needs: a fixed Shopify-like filter vocabulary compiled to `RuleSet`, list use case, admin wiring + routes, 5 default segments, members table. Design decision needed before planning. |
| Users & permissions | `/users`, `/users/:id/deactivate`, `/memberships`, `/memberships/:id/role` (admin-routes ~1943–2009); `/security/roles*`, `/security/role-assignments*`, `/security/mfa/*`; role table is 3 fixed roles admin/operator/viewer (`packages/auth/src/role-table-access-control.ts`) | Staff list + invite (email) + role change + deactivate, MFA enrollment for self, "require 2FA" policy, activity log from `AuditEvent`. Shopify's 18 permission groups need custom roles → out of 1b (fixed roles first).                                                                                         |

## REA additions (from `shopify-rea-feature-map.md`, live Shopify admin router)

- Customers: also merge customers, store-credit account + transactions, marketing-consent page, segment templates.
- Products: duplicate product/variant, bulk add to collections / tags / sales channels.
- Files page: Shopify keeps Files, Menus, Redirects and Blog posts all under Content.

## Proposed 1b order

1. Files page (UI only, sonnet).
2. Customers write backend (terra) → Customers UI create/edit/tags/notes/export (sonnet).
3. Users & permissions with the 3 fixed roles (backend glue terra, UI sonnet).
4. Segments (after the filter-vocabulary design is agreed).

## Decisions to raise with the owner when 1b is planned

- Segments: Shopify-style fixed filters (recommended) vs exposing the generic rules engine.
- Staff permissions: 3 fixed roles now, custom roles later (recommended) vs custom roles in 1b.
