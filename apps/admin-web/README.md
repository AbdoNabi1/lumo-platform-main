# apps/admin-web

The operator dashboard. A server-rendered Next.js app that calls the Runtime API
(`apps/runtime`, served by `apps/admin`'s routes) over HTTP — it never talks to a database or a
`services/*` package directly, and it never calls the Runtime API from browser JS: that API has no
CORS configured, and the bearer credential must never reach client code.

## Adding a write screen

This is the exact recipe a future task follows to add a screen that mutates something, using
`/products/new` (create) and the product detail page's name/slug editor (edit) as the two
reference implementations (`docs/plans/PHASE-1-admin-write-layer.md`, T1.3/T1.4).

1. **Find the route** in `apps/admin/src/http/*-routes.ts`. Record its path, method, `permission`,
   whether it is `idempotent`, and its zod body schema — these four facts are the contract between
   this app and the backend.
2. **Add a typed function** to the matching `apps/admin-web/src/lib/api/<domain>.ts`, calling
   `mutateAdminApi(path, { method, body, idempotencyKey }, isValid)` from `lib/api/client.ts`. Type
   only the fields you actually read off the response — if the route returns a domain aggregate
   rather than a DTO (check its handler in `*-routes.ts`), do not type the whole aggregate; read
   just the id or fields you need.
3. **Add a `"use server"` action** in `apps/admin-web/src/app/<route>/actions.ts`. It must:
   - parse `FormData` itself, defensively (a hidden field is not a trust boundary — re-derive
     anything security-relevant, e.g. re-read an id from `FormData` rather than trusting a closure
     variable);
   - call `newIdempotencyKey()` (`lib/api/mutation.ts`) exactly once per invocation — one key per
     user-initiated submit, never one per retry, so a double-click or an action replay cannot
     create two records;
   - call the `lib/api/<domain>.ts` function;
   - on `ok`: call `revalidatePath(...)` for every path that now shows stale data, **then**
     `redirect(...)` if the screen navigates away. `redirect()` throws a control-flow error by
     design — call it after `revalidatePath`, never inside a `try`/`catch` that would swallow it;
   - on anything else: `return toFormState(result, t.formErrors)`, resolving the locale the same
     way pages do (`cookies()` → `LOCALE_COOKIE` → `dictionaryFor`).
4. **Add a `"use client"` form** using `useActionState(actionFn, { status: "idle" })`, rendering
   `state.fieldErrors[name]` under the matching input with `aria-invalid`/`aria-describedby`, and
   disabling submit while `isPending` via `Button`'s `loading` prop.
5. **Add every string** the screen introduces to `messages/en.ts` **and** `messages/ar.ts`. `en.ts`
   is the source of truth (`Dictionary` is inferred from it); a key added there and not in `ar.ts`
   is a type error.
6. **Check `middleware.ts`'s `ROUTE_ROLE_REQUIREMENTS`** covers the new path at the right role.
   Longest-prefix match — a write screen usually needs `operator` even when its parent list screen
   is `viewer`-readable (a viewer must not be able to open a create/edit form they cannot submit).

## Three rules that are easy to get wrong

- **Never call the runtime API from browser JS.** Every fetch to `RUNTIME_API_URL` happens in a
  Server Component, a Server Action, or a route handler — never in a Client Component.
- **Never send a client-supplied price or amount.** The backend re-derives every price server-side
  (`apps/admin/src/http/pricing-resolution.ts`); this app never sends one to trust.
- **One `Idempotency-Key` per submit, not per retry.** Mint it once in the action, before the
  first attempt; do not mint a fresh one if `mutateAdminApi` is retried internally, or a retry
  stops being idempotent.

## Reference implementations

- Create: `lib/api/products.ts`'s `createProduct` → `app/products/actions.ts`'s
  `createProductAction` → `components/products/product-create-form.tsx` → `app/products/new/page.tsx`.
- Edit: `lib/api/products.ts`'s `updateProduct` → `app/products/actions.ts`'s
  `updateProductAction` → `components/products/product-edit-form.tsx`, rendered from
  `app/products/[productId]/page.tsx`.
- The shared transport: `lib/api/client.ts`'s `mutateAdminApi` / `MutationResult`, and
  `lib/api/mutation.ts`'s `newIdempotencyKey` / `toFormState`.
