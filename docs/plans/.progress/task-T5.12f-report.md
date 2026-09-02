# Task T5.12f report — Security write actions: Authorization (policy definition tier — LAST)

## Summary

Added the 18 write routes from `security-authorization-routes.ts` (roles, policies including
publish/simulate, ReBAC relations, access checks, registries, delegations/impersonation, tenant
security profile) to the existing read-only `/security/access` screen. This is the plan's explicit
"policy definition" high-blast-radius category and the last of T5.12's 6 parts. T5.12's own
checkbox in `docs/plans/PHASE-5-6-backlog.md` has been ticked.

## Files changed

1. **`apps/admin-web/src/lib/api/security.ts`** (appended, ~700 lines) — one typed `mutateAdminApi`
   wrapper per write route (18 total), following the file's established `isX(value): value is X`
   type-guard pattern. New exported types: `SecurityScopeInput`, `PolicyMode`, `PolicyEffect`,
   `IsolationTier`, `RoleOutputDto`, `RoleAssignmentOutputDto`, `PolicyOutputDto`,
   `SimulatePolicyContextInput`, `ZeroTrustDecisionDto`, `RelationTupleWriteInput`,
   `RelationTupleOutputDto`, `DeleteRelationTupleResultDto`, `CheckAccessInput`, `AbacMismatchDto`,
   `AccessModelDecisionDto`, `RiskSignalsInput`, `TrustSignalsInput`, `EvaluateAccessInput`,
   `AccessDecisionOutputDto`, `RegistryEntryOutputDto`, `RegisterPolicyFragmentInput`,
   `RegisterPermissionInput`, `DelegationOutputDto`, `GrantDelegationInput`,
   `StartImpersonationInput`, `ImpersonationOutputDto`, `TenantSecurityProfileOutputDto`,
   `ConfigureTenantSecurityConfigInput`. Every DTO was verified against the actual backend
   application-layer output type (`services/security/src/application/{authorization,policy,authz,
   access,registry,delegation,tenant-security}.use-cases.ts`), never assumed.
2. **`apps/admin-web/src/app/security/access/actions.ts`** (new) — 18 Server Actions (`"use server"`),
   one per route, following the established recipe: parse `FormData` defensively, mint a fresh
   `Idempotency-Key` per submit, call the typed `lib/api/security.ts` function,
   `revalidatePath("/security/access")` on `ok` (except the 3 preview/explainer routes —
   `simulatePolicyAction`/`checkAccessAction`/`evaluateAccessAction` — which never revalidate),
   otherwise project through `toFormState`.
3. **`apps/admin-web/src/components/security/access-actions.tsx`** (new) — 18 client components
   (forms/per-row forms/preview panels), following the sibling `sessions-actions.tsx` recipe.
4. **`apps/admin-web/src/app/security/access/page.tsx`** (extended) — organized into 7 sub-sections
   (Roles / Policies / Relations / Access Checks / Registries / Delegations & Impersonation / Tenant
   Security), same long-page-with-clear-headings approach T5.12e used. Added a `getCurrentUser()`
   call to pre-fill `AssignRoleForm`'s `grantedBy` field, and an `actions` column to the Roles and
   Policies tables for the new per-row controls.
5. **`apps/admin-web/src/messages/en.ts`** / **`apps/admin-web/src/messages/ar.ts`** — every new
   user-facing string added to both dictionaries under `securityAccessPage`, mirroring the existing
   key structure exactly (`ar.ts` is typed as `Dictionary`, so a structural mismatch is a compile
   error).
6. **`apps/admin-web/src/lib/i18n.test.ts`** — added 3 entries to `SHARED_VERBATIM` (the raw-JSON
   example placeholders for `rules`/`abac`/`expression` — machine-syntax snippets, not natural
   language, same rationale as the existing `pricingPage.datetimePlaceholder` entry).
7. **`docs/plans/PHASE-5-6-backlog.md`** — ticked T5.12's own checkbox (`- [x] **T5.12 Security
   write actions.**`), since this is the last of the 6 parts and all 5 prior parts were confirmed
   done before this part was dispatched.

## Route-by-route decisions

**Roles** (`RoleSummaryRowDto` exposes `key` per row — verified against the actual DTO):
- `defineRole` — standalone form.
- `grantRolePermission` — per-row control on the permission explorer's Roles table.
- `assignRole` — standalone form; `grantedBy` pre-filled from `getCurrentUser()`, same "audit actor"
  pattern Feature Flags' `changedBy` uses.
- `revokeRoleAssignment` — standalone form (no assignment explorer is wired on this page), confirmed
  before submit.

**Policies** (`PolicySummaryRowDto`/`PolicyExplorerRowDto` expose `key` per row):
- `definePolicy` — standalone form.
- `publishPolicyVersion` — per-row control on the Policies table. `rules` is a raw JSON textarea (an
  array of `{id, description, when, expr?, effect}` rule objects, `when`/`expr` themselves the
  backend's own `z.unknown()` recursive-expression-language fields) — never a structured per-rule
  editor, per the brief's explicit instruction. Confirmed with an explicit dialog naming the exact
  policy key (a live-traffic change), plus client-side JSON well-formedness validation before
  submit, re-validated server-side.
- `archivePolicy` — per-row control, confirmed before submit.
- `simulatePolicy` — standalone preview panel (manually-typed `policyKey`; "(read-only)" per its own
  route summary despite being a POST), same "try it" treatment T5.12e's `decideMfa`/`evaluateRisk`
  use. Never `revalidatePath`s.

**ReBAC relations** — no relation-tuple explorer is wired on this page, so `writeRelationTuple` and
`deleteRelationTuple` are both standalone forms (4 fields: namespace/object/relation/subject); delete
is confirmed before submit.

**Access checks** (explicitly "read-only tools, not mutations" per the brief) — `checkAccess` and
`evaluateAccess` are both standalone preview panels, never `revalidatePath`. `checkAccess`'s `abac`
field is the backend's `z.unknown()` `AbacCondition` — a raw JSON textarea. `evaluateAccess`'s
`risk`/`trust` structured signal objects are rendered as individual typed fields (not a free-form
bag) since they are the actual substance of what this "single authorization entry point" preview
evaluates.

**Registries** — `registerPolicyFragment` (standalone; `expression` is the backend's `z.unknown()`
field, raw JSON textarea) and `registerPermission` (standalone) — no per-registry-kind row exists on
the registry explorer to attach to (its rows are keyed by registry *name* with a nested `entries`
array spanning every registry kind).

**Delegations & impersonation** (no delegation explorer is wired on this page):
- `grantDelegation` — standalone form.
- `revokeDelegation` — standalone form, confirmed before submit (generic confirm text, per the
  brief's plain "Confirm before submit" language for this one, distinct from the two explicitly-named
  confirmations below).
- `startImpersonation` — **the single highest-risk individual action in this entire phase** per the
  brief. `StartImpersonationForm` collects `delegatorExternalId`/`delegateExternalId` purely as
  admin-typed, display-only context for an unmistakable `window.confirm` naming both principals
  (neither field is sent to the API — only `delegationId`, the route's actual identifier, reaches the
  wire); on top of that, the submit button stays disabled until the admin re-types the exact
  `delegationId` into a separate "type to confirm" field, which the server action also re-validates
  defensively. This is the extra friction step the brief left to my judgment — I added it given the
  brief's own comparison to "how destructive cloud-console actions gate irreversible operations."

**Tenant security** — `configureTenantSecurity` is a standalone form. Its backend route body schema
is the flat config object itself (the handler reshapes it into `{tenantRef, config: body}`
server-side), unlike `governAiIdentity`/`governMachineIdentity`'s `{config}`-wrapped bodies — this is
called out explicitly in `configureTenantSecurity`'s doc comment in `security.ts` to prevent a future
implementer from copying the wrong wrapping convention.

## Verification

```
cd "D:\lumo-platform-main-main\lumo-platform-main-main"
pnpm --filter admin-web typecheck   # clean, no errors
pnpm --filter admin-web lint        # clean (1 pre-existing, unrelated warning in next.config.ts)
pnpm --filter admin-web test        # 581 passed, 63 files, 0 failed
```

No test file was added for the new `lib/api/security.ts` functions themselves — matching the
established precedent: only T5.12a (`governAiIdentity`/`suspendAiIdentity`/`checkAiAction`) added
dedicated `describe` blocks to `security.test.ts`; T5.12b through T5.12e's own new mutate functions
did not, and the generic `mutateAdminApi` wrapper they all share is already covered by
`client.test.ts`/`mutation.test.ts`.

## Concerns / judgment calls

1. **`rules`/`expression`/`abac` treated as one opaque JSON blob, not per-field raw-JSON.** The
   brief says "render `when`/`expr` as raw JSON" (singular, per-field), but `publishPolicyVersion`'s
   `rules` is an *array* of rule objects each containing `when`/`expr`. Building a repeatable-row
   editor for `{id, description, effect}` with two nested raw-JSON sub-fields per row would edge
   toward the "structured policy-rule editor" the brief explicitly rules out, so I treated the whole
   `rules` array as one JSON textarea instead (documented in both `security.ts` and
   `access-actions.tsx`). Same reasoning applied to `registerPolicyFragment`'s `expression` and
   `checkAccess`'s `abac` — each is one opaque JSON textarea, not partially typed.
2. **`resourceAttributes`/`environmentAttributes` on `checkAccess` and `metadata`-style free-form
   bags are omitted from the forms**, consistent with every prior T5.12 part's own treatment of
   `Record<string,string>` bags (e.g. `registerAuthMethod`'s `config`, `establishSession`'s
   nonexistent metadata) — not fabricated, not silently dropped from the type, just left off the UI.
3. **Permission/allowed-auth-method lists render as one newline-separated textarea**, not a
   dynamic add/remove row group like Component Library's `properties`. These are plain string
   arrays with no per-item structure, so a textarea-per-line was simpler and equally complete; noted
   in `parseLines`'s own doc comment in `actions.ts`.
4. No genuine blocker was hit — `docs/plans/BLOCKERS.md` was not touched.
