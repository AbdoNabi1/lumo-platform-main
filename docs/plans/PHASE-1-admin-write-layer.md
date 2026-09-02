# Phase 1 — The admin write layer

**Goal:** give `apps/admin-web` the ability to call a write endpoint at all, and prove the pattern
end-to-end on one real screen.

**Why this is first:** `apps/admin-web/src/lib/api/client.ts` exports exactly one function,
`getAdminApi`, and its `fetch` call passes no `method` — so it is GET-only. There is no
`postAdminApi`, and the only Server Action in the app (`apps/admin-web/src/app/actions.ts`) sets a
locale cookie. That is why **0 of the backend's 304 write endpoints** are reachable from the
operator UI. Every "add a create/edit screen" task in Phase 3 and Phase 5 is blocked on this file.

**Estimated size:** 5 tasks, ~4 days.

**Depends on:** Phase 0 complete.

---

## Background you need before writing code

### The transport contract

Read `packages/http/src/server.ts` and `packages/http/src/route.ts` once. The facts that matter:

| Concern      | Contract                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| Path prefix  | `/api/v1` + the route's `path` (the `version: 1` field becomes the prefix)                                              |
| Auth         | `Authorization: Bearer <token>` — the staff session JWT, or `ADMIN_API_TOKEN` as the server-to-server fallback           |
| Tenant       | `x-tenant-id` header, required, resolved by `headerTenantResolver`                                                      |
| Idempotency  | `Idempotency-Key` **request header**, honoured only on routes declared `idempotent: true`; a claim collision returns 409 |
| Rate limit   | 300 requests / 60s, per principal                                                                                       |
| Correlation  | `x-correlation-id` in, echoed back with `x-request-id`                                                                 |

### The error envelope

Every non-2xx response body is the uniform envelope from
`packages/utils/src/error-envelope.ts`:

```ts
interface ErrorEnvelope {
  readonly code: string;              // "VALIDATION" | "NOT_FOUND" | "CONFLICT" | ...
  readonly message: string;
  readonly retryable: boolean;
  readonly fields: readonly FieldIssue[];   // [{ field, message }] — per-field validation errors
  readonly traceId?: string;
}
```

Status mapping (`packages/http/src/error-mapping.ts` and each context's `present()`):

| `code`                            | HTTP |
| --------------------------------- | ---- |
| `VALIDATION`                      | 422  |
| `NOT_FOUND`                       | 404  |
| `CONFLICT` / `CONCURRENCY` / `BUSINESS_RULE` | 409 |
| `UNAUTHENTICATED`                 | 401  |
| `FORBIDDEN`                       | 403  |
| `RATE_LIMITED`                    | 429  |
| anything else                     | 500  |

`fields` is the reason mutations need a richer result type than `getAdminApi`'s: a 422 must be
rendered next to the offending form input, not as a toast.

### The pattern to copy

`apps/storefront/src/app/cart/actions.ts` + `apps/storefront/src/lib/runtime-api.ts` already
implement server-side mutation correctly for the public surface. Copy its **shape**: a typed
non-throwing transport helper, wrapped by `"use server"` actions that own cookies and
`revalidatePath`, called directly from Client Components. Do not copy its auth — the storefront
sends no token.

---

## T1.1 — Add `mutateAdminApi` to the API client

- [x] Task complete

**File:** `apps/admin-web/src/lib/api/client.ts` (edit — do not create a second client).

**Steps**

1. Extract the shared preamble of `getAdminApi` (resolve `RUNTIME_API_URL` via `requireProdEnv`,
   resolve `TENANT_DEFAULT_ID`, read the session via `readSession()`, fall back to
   `process.env["ADMIN_API_TOKEN"]`, build the headers object) into a private
   `async function adminRequestHeaders(): Promise<Record<string, string>>`. Have `getAdminApi` use
   it, so the two paths cannot drift.
2. Add a result type for mutations beside the existing `ApiResult<T>`. **Do not change
   `ApiResult<T>`** — 12 call sites depend on it.

   ```ts
   /** One field-level validation failure, as returned in the API error envelope's `fields`. */
   export interface FieldIssue {
     readonly field: string;
     readonly message: string;
   }

   /**
    * The outcome of a write. Richer than `ApiResult` on purpose: a 422 carries per-field issues
    * that a form must render next to the offending input, and a 409 is a distinct, user-actionable
    * state (someone else changed this record / this key is already in flight) rather than a
    * generic error.
    */
   export type MutationResult<T> =
     | { readonly outcome: "ok"; readonly data: T }
     | { readonly outcome: "unauthorized" }
     | { readonly outcome: "forbidden" }
     | { readonly outcome: "not_found" }
     | { readonly outcome: "conflict"; readonly message: string }
     | { readonly outcome: "invalid"; readonly message: string; readonly fields: readonly FieldIssue[] }
     | { readonly outcome: "error"; readonly message: string };
   ```

3. Add the function itself:

   ```ts
   /**
    * Sends a write to the admin runtime API. Never throws — every failure mode is a typed outcome,
    * same discipline as `getAdminApi`.
    *
    * Server-side only, exactly like `getAdminApi`: the runtime API has no CORS configured
    * (`packages/http/src/server.ts`) and the bearer credential must never reach client code. Call
    * this from a Server Action, never from a Client Component.
    *
    * `idempotencyKey` maps to the `Idempotency-Key` request header, which
    * `packages/http/src/server.ts` honours for every route declared `idempotent: true` — which is
    * nearly all of them. Callers should pass a fresh key per user-initiated submit (not per retry),
    * so that a double-click or a Server Action replay cannot create two records.
    */
   export async function mutateAdminApi<T>(
     path: string,
     init: {
       readonly method: "POST" | "PUT" | "PATCH" | "DELETE";
       readonly body?: unknown;
       readonly idempotencyKey?: string;
     },
     isValid: (value: unknown) => value is T,
   ): Promise<MutationResult<T>>
   ```

   Implementation requirements, in order:
   - headers = `await adminRequestHeaders()`, plus `"content-type": "application/json"` when
     `body !== undefined`, plus `"idempotency-key": init.idempotencyKey` when present.
   - use `fetchWithTimeout` from `@/lib/fetch-with-timeout` — never bare `fetch`. A hung API must
     not hang the action.
   - a thrown fetch → `{ outcome: "error", message }`, exactly as `getAdminApi` does.
   - parse the body with `await response.json().catch(() => null)` **regardless of status** — a
     422 and a 409 both carry an envelope you need. (This is why `postItem` in the storefront's
     `runtime-api.ts` does the same.)
   - map status → outcome: 401 → `unauthorized`, 403 → `forbidden`, 404 → `not_found`,
     409 → `conflict`, 422 → `invalid`, other non-2xx → `error`.
   - for `invalid`, read `code`/`message`/`fields` off the parsed envelope defensively — treat a
     missing or malformed `fields` as `[]`, never crash on it.
   - on 2xx, run `isValid` and return `{ outcome: "error", message: "Admin API returned an
     unexpected response shape" }` when it fails — same wording and behaviour as `getAdminApi`.
   - a 204 / empty body on 2xx must not be treated as a parse failure. Accept `null` and pass it
     to `isValid`; callers that expect no content pass an `isVoid` guard.

4. Export `MutationResult` and `FieldIssue` from wherever `ApiResult` is already exported.

**Tests** — create `apps/admin-web/src/lib/api/client.test.ts`, following the style of the existing
`apps/admin-web/src/lib/api/orders.test.ts` (stub `global.fetch`). Cover, at minimum:

- a 201 with a valid body → `ok`
- a 422 with `fields` → `invalid` with those fields preserved
- a 409 → `conflict`
- a 401 → `unauthorized`, a 403 → `forbidden`, a 404 → `not_found`
- a thrown fetch → `error`
- `idempotencyKey` present → the `idempotency-key` header is sent
- `idempotencyKey` absent → the header is **not** sent
- a 2xx whose body fails `isValid` → `error`

**Acceptance:** `mutateAdminApi` exists, is exported, never throws, and the tests above pass.

**Verify:**

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

---

## T1.2 — Add the shared Server Action helpers

- [x] Task complete

**File:** create `apps/admin-web/src/lib/api/mutation.ts`.

Two helpers every write action will use, so 40 future actions do not each reinvent them.

```ts
import { randomUUID } from "node:crypto";

/** A fresh Idempotency-Key for one user-initiated submit. Server-only (`node:crypto`). */
export function newIdempotencyKey(): string {
  return randomUUID();
}
```

Plus a form-state type that Client Components can render without knowing about HTTP:

```ts
import type { FieldIssue, MutationResult } from "./client";

/** What a form renders after a submit. `fieldErrors` is keyed by input name. */
export type FormState =
  | { readonly status: "idle" }
  | { readonly status: "success" }
  | {
      readonly status: "error";
      /** A single sentence to show above the form. */
      readonly message: string;
      /** Per-input messages, keyed by the field name the API reported. */
      readonly fieldErrors: Readonly<Record<string, string>>;
    };

/**
 * Projects a `MutationResult` onto the shape a form renders. Message text is looked up by the
 * caller from its own dictionary — this returns a stable key, not English prose, so both locales
 * stay correct. See `messages/en.ts`'s `formErrors` section.
 */
export function toFormState(result: MutationResult<unknown>, t: FormErrorDictionary): FormState
```

Requirements:

- `unauthorized` / `forbidden` → message from the dictionary, no field errors.
- `conflict` → the API's own `message` (it is written for operators, e.g. "already in flight").
- `invalid` → `fieldErrors` built from `result.fields`, plus the dictionary's generic
  "check the highlighted fields" message. A field issue whose `field` is empty goes into the
  top-level message instead of being dropped.
- `not_found` / `error` → dictionary message.

Add a `formErrors` section to **both** `apps/admin-web/src/messages/en.ts` and `ar.ts` with keys:
`unauthorized`, `forbidden`, `notFound`, `conflict`, `invalid`, `unexpected`. Define the type
`FormErrorDictionary` as that section's type, derived from `en.ts` (do not hand-write it).

**Tests:** `apps/admin-web/src/lib/api/mutation.test.ts` covering each `MutationResult` variant →
expected `FormState`, including the empty-`field` case.

**Acceptance:** `toFormState` is pure, total over every `MutationResult` variant, and locale-safe.

**Verify:**

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web test
```

---

## T1.3 — Prove the pattern: create a product

- [x] Task complete

This is the reference implementation every later write screen copies. Get it right; it is worth
more than the feature itself.

### The endpoint

`POST /api/v1/products` — `apps/admin/src/http/admin-routes.ts:708` (`path: "/products"`, the POST — note line 718 is the GET on the same path), `idempotent: true`,
permission `products:create`. Its zod body schema (`createProductBody`, `admin-routes.ts:74`) is
exactly:

```ts
{
  sku: string (min 1),
  name: string (min 1),
  slug: string (min 1),
  variants: Array<{
    sku: string (min 1),
    priceAmountMinor: integer > 0,
    currency: string (length exactly 3),
  }>  // min 1 — at least one variant is required
}
```

Success is **201**. The response body is the created `Product` **aggregate**, not a DTO — this
route returns `admin.products.createProduct(...)` directly. Do **not** type the whole aggregate in
the frontend. Validate only that the response is an object, and redirect to the detail page using
the id you read off it; if the id is not readable, redirect to `/products` instead of guessing.

### Files

1. **`apps/admin-web/src/lib/api/products.ts`** (edit — it already holds the three product reads):
   add `createProduct(input): Promise<MutationResult<{ id: string }>>` calling
   `mutateAdminApi("/api/v1/products", { method: "POST", body: input, idempotencyKey }, isCreated)`.
   Write `isCreated` to accept an object with a string `id` at either `id` or `props`-free
   top level; if neither is present, still return `ok` with `{ id: "" }` — a created product with an
   unreadable id is a redirect problem, not a failure to report to the operator.

2. **`apps/admin-web/src/app/products/actions.ts`** (create):

   ```ts
   "use server";
   ```

   Export `createProductAction(previous: FormState, formData: FormData): Promise<FormState>`.
   It must:
   - parse `FormData` into the body shape above; parse `priceAmountMinor` with
     `Number.parseInt(value, 10)` and reject `NaN` locally as an `invalid` state rather than
     sending it;
   - call `newIdempotencyKey()` once per invocation;
   - call `createProduct`;
   - on `ok`: `revalidatePath("/products")` then `redirect(...)` to the new product's detail page
     (`/products/<id>`), or `/products` when the id was unreadable. Note: `redirect()` throws a
     control-flow error by design — call it **after** `revalidatePath`, and never inside a
     `try`/`catch` that would swallow it;
   - on anything else: `return toFormState(result, t.formErrors)` — resolving the locale the same
     way pages do (`cookies()` → `LOCALE_COOKIE` → `dictionaryFor`).

3. **`apps/admin-web/src/components/products/product-create-form.tsx`** (create): a Client
   Component (`"use client"`) using `useActionState` with `createProductAction`. It must:
   - render inputs for `sku`, `name`, `slug`, and a repeatable variant row
     (`sku`, `priceAmountMinor`, `currency`) starting with one row and an "add variant" button;
   - render `state.fieldErrors[name]` under the matching input, with
     `aria-invalid` and `aria-describedby` wired to the message element;
   - render `state.message` in an alert region above the form when present;
   - disable the submit button while `isPending`, using the existing `Button`'s `loading` prop
     (see `apps/storefront/src/components/add-to-cart-button.tsx` for the idiom);
   - use only `@platform/ui` primitives — do not add a new dependency, and do not hand-roll inputs.

4. **`apps/admin-web/src/app/products/new/page.tsx`** (create): a Server Component that renders
   `AppShell` + the form, following the preamble in `apps/admin-web/src/app/products/page.tsx`
   (locale cookie → `dictionaryFor` → `getCurrentUser` → `<AppShell activeNavId="products">`).

5. **`apps/admin-web/src/app/products/page.tsx`** (edit): add a "New product" `Button` linking to
   `/products/new` in the page header.

6. **`apps/admin-web/src/middleware.ts`** (edit): `ROUTE_ROLE_REQUIREMENTS` is a longest-prefix
   match and `/products` is already listed. Confirm the role required for `/products` is at least
   `operator`; if it is currently `viewer`, add an explicit `["/products/new", "operator"]` entry
   **above** the `/products` entry so a viewer cannot open a create form they cannot submit.
   Do not lower any existing requirement.

7. **Dictionaries:** add a `productCreate` section to `en.ts` and `ar.ts` — page title, subtitle,
   every field label, the variant add/remove buttons, and the submit button label.

**Tests**

- `apps/admin-web/src/lib/api/products.test.ts` (create or extend): `createProduct` sends the right
  path, method, body and idempotency header; maps a 422 to `invalid` with fields.
- `apps/admin-web/src/components/products/product-create-form.test.tsx`: renders field errors from
  a supplied `FormState`; the submit button is disabled while pending. Follow the testing idiom in
  `apps/storefront/src/components/add-to-cart-button.test.tsx`.

**Acceptance:** an operator can open `/products/new`, submit, and land on the new product's detail
page. A 422 renders per-field messages in place. A double-submit creates one product.

**Verify:**

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

---

## T1.4 — Second proof: edit a product's name and slug

- [x] Task complete

One create and one edit together prove both halves of the pattern. Keep this one deliberately
small — it exists to confirm the helpers generalise, not to build the full product editor (that is
Phase 5).

**Endpoint:** `POST /api/v1/products/:productId` — `admin-routes.ts:761` (the second `path: "/products/:productId"` — line 728 is the GET), `idempotent: true`,
permission `products:update`, body `{ name: string, slug: string }` (`updateProductBody`,
`admin-routes.ts:367`). Success is 200.

**Steps**

1. `apps/admin-web/src/lib/api/products.ts`: add
   `updateProduct(productId, { name, slug }): Promise<MutationResult<unknown>>`.
2. `apps/admin-web/src/app/products/actions.ts`: add
   `updateProductAction(previous, formData)`. On success `revalidatePath("/products")` **and**
   `revalidatePath(\`/products/${productId}\`)`, then return `{ status: "success" }` — do not
   redirect; the operator stays on the detail page.
3. `apps/admin-web/src/components/products/product-edit-form.tsx`: a Client Component with the two
   inputs, pre-filled from the product already loaded by the detail page. Same
   `useActionState` / field-error / pending treatment as T1.3. Pass `productId` through a hidden
   input, and re-read it from `FormData` in the action — never trust it from anywhere else.
4. `apps/admin-web/src/app/products/[productId]/page.tsx`: render the form. The page already
   fetches the product via `fetchProduct`; pass `name` and `slug` into the form as defaults.
5. Add the labels to both dictionaries.

**Acceptance:** editing name/slug on a product detail page persists and the page shows the new
values after revalidation, with no full reload.

**Verify:**

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

---

## T1.5 — Write the pattern down

- [x] Task complete

**File:** create `apps/admin-web/README.md` (or append a section if one exists).

Document, in under a page, the exact recipe a future task follows to add a write screen:

1. Find the route in `apps/admin/src/http/*-routes.ts`. Record its path, method, `permission`,
   whether it is `idempotent`, and its zod body schema — these four facts are the contract.
2. Add a typed function to the matching `apps/admin-web/src/lib/api/<domain>.ts` calling
   `mutateAdminApi`.
3. Add a `"use server"` action in `apps/admin-web/src/app/<route>/actions.ts` that owns
   `newIdempotencyKey()`, `revalidatePath`, and `toFormState`.
4. Add a `"use client"` form using `useActionState`, rendering `fieldErrors` inline.
5. Add every string to `messages/en.ts` **and** `messages/ar.ts`.
6. Check `middleware.ts`'s `ROUTE_ROLE_REQUIREMENTS` covers the new path at the right role.

State the three rules that are easy to get wrong: never call the runtime API from browser JS;
never send a client-supplied price or amount; one `Idempotency-Key` per submit, not per retry.

Link this file from the root `README.md`'s structure table.

**Acceptance:** a reader who has never seen this codebase can add a write screen from this document
plus the two reference implementations.

---

## Phase 1 exit criteria

- [x] `mutateAdminApi` exists, is tested, and never throws.
- [x] `toFormState` covers every `MutationResult` variant, in both locales.
- [x] `/products/new` creates a product; the product detail page edits name and slug.
- [x] Field-level 422 errors render next to their inputs.
- [x] `pnpm --filter admin-web typecheck && lint && test` all pass.
- [x] The recipe is written down in `apps/admin-web/README.md`.
