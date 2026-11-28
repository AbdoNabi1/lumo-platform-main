# Lead Site Part C — plan review round 2 (convergence)

Reviewed against committed HEAD `241d75cec3203907376552c2dea33cc7900fec3e` (Task 1 base: `5eefc1f9`). Scope is exclusively round-1 findings 1–14 and contradictions that the binding precedence rule cannot resolve. No new scope, OPTIONAL upgrades, or reconsideration of owner decisions.

**Disposition: all 14 findings are resolved at the plan-contract level.** This is not acceptance of the concurrent Task 1 fix or a claim that Tasks 2–7 are implemented. Committed Task 1 still lacks the submission-key amendment; its binding fix-round instructions are what this review approves.

## Evidence and precedence

- `Plan:Lx–Ly` means `docs/superpowers/plans/2026-11-22-lead-site-part-c-lead-form-and-inbox.md`, at the reviewed commit. Its working-tree text was programmatically checked to match the committed text.
- `Plan:L61–80` establishes amendments over original text. Each task has exactly one round-1 amendment block, verified programmatically. Superseded instructions are not separate defects: this includes public `idempotent: true`, the 86,400-second marker, unsupported fake-query tests and the admin-local commerce tuple.
- All code evidence below was read through `git show HEAD:<path>`, never concurrent working-tree source. HEAD was rechecked as `241d75ce` after evidence collection.
- Round-1 triage (`2026-11-22-lead-site-part-c-plan-review-1.md:L49–70`) accepts all 14 findings and requests the finding-6 mechanism ruling below.
- Root `AGENTS.md` was not found. Only this review file was written; no git-status checks, code/plan edits, installs, migrations, commits or Next builds were performed.

## Numbered round-1 dispositions

### 1. BLOCKING — Resolved: executable Prisma test-double contract

**Plan:** `L494–506` replaces unsupported fake semantics with a recording client defined in `prisma-lead-repository.test.ts`: queued results, delegate/raw-call recording, transaction callback, exact query assertions and tenant configuration before each query. A named `DATABASE_URL_TEST` integration suite proves actual search/sort/pagination semantics, including the shared use-case suite.

**Code:** `packages/db/src/testing/fake-prisma.ts:L29–60,L116–120,L136–168` still rejects `OR`, lacks `contains`, ignores sorting and has no call log; the amendment no longer relies on those capabilities. `packages/db/src/transaction.ts:L41–72` really uses the transaction callback and tagged raw call the recorder must observe. `packages/db/src/testing/index.ts:L13–32` supplies the gated real-client pattern.

**Fix adopted:** exact-query/tenant-order unit assertions plus real-DB semantic assertions, without changing production filtering to satisfy a fake. No remaining plan fix required.

### 2. BLOCKING — Resolved: shop-facts failure has a real 503 mapping

**Plan:** `L616–619` requires `AppError("shop facts unavailable", { code: "UNAVAILABLE" })` for rejected reads, non-200 responses and malformed facts, with rejection/non-200 tests proving no insert or claim.

**Code:** `packages/utils/src/errors.ts:L3–19` accepts that constructor shape; `packages/utils/src/error-envelope.ts:L36–44` preserves its fixed safe message/code. `packages/http/src/error-mapping.ts:L20,L28–31` maps `UNAVAILABLE` to 503, unlike a plain Error. A committed-source execution probe confirmed both mappings.

**Fix adopted:** explicit safe error type/code, not an assumed thrown-Error mapping. No remaining plan fix required.

### 3. BLOCKING — Resolved: unknown response body with guards

**Plan:** `L851–855` changes `createLead` to `body: unknown`, names the success guard and validation-fields reader, defines malformed 201 as `network` with no cookie, and requires real 422 and malformed-201 tests.

**Code:** `apps/storefront/src/lib/runtime-api.ts:L305–330` reads non-2xx JSON under its supplied generic and can return null after JSON failure. `packages/utils/src/error-envelope.ts:L5–10,L18–25` confirms the real top-level `fields[].field` envelope. The new contract can handle both without casting an error as a success DTO.

**Fix adopted:** explicit narrowing at the action boundary. No remaining plan fix required.

### 4. BLOCKING — Resolved: marker slides for the complete active session

**Plan:** `L856–860` renews the matching HttpOnly marker alongside the sid with 1,800 seconds, deletes a mismatched/new-sid marker, and changes the action's marker lifetime. The cookie-jar/clock oracle covers activity every 25 minutes for 25 hours and a new session after 31 idle minutes.

**Code:** `packages/tracking/src/leads/lead-emission.ts:L55–81` expires unextended claims at the stored TTL; Redis alone cannot cover the long active session. `apps/storefront/src/middleware.ts:L193–198` defines the matched-request boundary into which Task 5 inserts renewal.

**Fix adopted:** cookie renewal and sid-bound clearing, preserving D1's no-per-page Redis-renewal decision. No remaining plan fix required.

### 5. BLOCKING — Resolved: visitor IP explicit; limiter fails closed

**Plan:** `L620–626` binds `tenantId = context.tenantId` and `visitorIp = body.context.ip`, names both keys/budgets, forbids caller-IP substitution and specifies 503 for absent/throwing limiters. Tests cover separate visitor IPs behind one caller, null IP, tenant separation and the 61st shop submission using distinct IPs.

**Code:** `packages/http/src/route.ts:L19–30` and `packages/http/src/server.ts:L552–559` distinguish caller IP from body context. `apps/admin/src/http/public-online-store-routes.ts:L40–56` actually fails closed; `apps/admin/src/http/rate-limited-response.ts:L1–7` supplies the 429 header.

**Fix adopted:** explicit visitor-signal source and mandatory enforcement, without reopening D2's accepted forgery limit. No remaining plan fix required.

### 6. BLOCKING — Resolved: lead-level idempotency mechanism accepted

**Ruling: accept the submission-key mechanism instead of a transport cacheability option.** It preserves durable successful deduplication without snapshotting transient refusals; no shared HTTP cache-policy change is required.

**Plan:**

- `L67–73`: public submit opts out of transport idempotency; required `Idempotency-Key` matches `^[A-Za-z0-9-]{8,128}$`; uniqueness is `(tenant_id, submission_key)`; 429/503 refusals are never stored.
- `L361–376`: domain/input key and tenant-qualified lookup; insert reports `inserted | duplicate`; a stored key returns its row's result before another claim/insert; an insertion race re-reads the winning row. The specified mapping `pending|sent|failed → emit`, `suppressed → suppressed`, `skipped_spam → spam` keeps output stable across tracking-delivery states. Sequential, spam and concurrent duplicate tests are explicit.
- `L489–493`: both Prisma and SQL gain the non-null column and tenant/key unique index; a matching unique violation becomes `duplicate`; lookup remains read-scoped and tenant-qualified.
- `L627–630`: case-insensitive header read, missing/invalid header → 422, passing `submissionKey`, one-row replay/concurrency assertions and same-key recovery after limiter failure.
- `L861–862,L917–918`: the client owns the key and keeps it after failure; the server action does not mint another key on retry.

**Code:** `packages/http/src/server.ts:L562–596` snapshots every returned response only when `route.idempotent === true`; otherwise the handler runs outside that cache path. Opting out removes cached refusals and the cached-header loss. `services/online-store/src/infrastructure/rows.ts:L27–31` provides the P2002 detector pattern; the amendment additionally limits duplicate handling to the submission-key index. At this HEAD, `services/leads/src/domain/lead-repository.ts:L13–19`, `services/leads/src/application/leads.use-cases.ts:L139–195` and `services/leads/src/infrastructure/in-memory-lead-repository.ts:L16–26` are still pre-fix interfaces/code: the amendment is required work, not functionality already verified here.

**Fix adopted:** persistent lead uniqueness and duplicate read-back, not removal of idempotency. Transient 429/503 responses are live refusals, not stored replay results; a refused request has no saved lead and can succeed after recovery/window expiry. No remaining plan fix required. The concurrent Task 1 implementation still needs separate code review/tests.

### 7. BLOCKING — Resolved: supported helper, dependency and public exports

**Plan:** `L356–360` ratifies the local helper and DB type dependency and enumerates the downstream public exports.

**Code:** `services/leads/src/domain/lead-search.ts:L6–16` implements the pure local Arabic/Persian converter; `lead-search.test.ts:L9–13` covers both alphabets. `services/leads/package.json:L18–26` contains `@platform/db`; `services/leads/src/composition.ts:L1–3,L16–33` uses its type and exports wiring contracts. `services/leads/src/index.ts:L1–23` exposes the listed controller, wiring, statuses, ports, views and inputs. A committed-source probe confirmed mixed-script conversion.

**Fix adopted:** preserve the supported local API rather than use a tracking deep import. No remaining plan fix required.

### 8. BLOCKING — Resolved: named RBAC harness and real multi-tenant signup path

**Plan:** `L631–643` names the leads harness, options, role-table adapter, persistent transport doubles, limiter template and produced `leadsShopFacts` injection seam, retaining the tenancy-backed default. The separate isolation suite extracts named shared helpers, signs A up as `lead_site` and B as `store`, and proves the gate, list/get isolation and forged-header behavior. Original status/export isolation requirements remain at `L588–590`.

**Code:** `apps/admin/src/http/testing/online-store-harness.ts:L34–50,L85–143` has the named limiter, persistent response state, atomic in-process transport claims and real RBAC. `apps/admin/src/http/merchant-onboarding-isolation.e2e.test.ts:L118–173` boots real multi-mode resolution/lifecycle gating; `L205–212` already submits a site type. `apps/admin/src/http/server.ts:L143–155` prioritizes verified claims and builds the gate. `services/tenancy/src/interfaces/tenancy.controller.ts:L116–118` confirms settlement stays in-process only.

**Fix adopted:** deterministic RBAC/failure tests plus real signup/composition/isolation coverage; no fictitious public seeding endpoint or assumption that file-local helpers are already shared. No remaining plan fix required.

### 9. BLOCKING — Resolved: revalidation after every API-reached write

**Plan:** `L982–989` specifies mutation/action signatures, `{ status }`, the endpoint, `FormState`, attempted-write/finally revalidation of both paths and local-validation exclusion. Tests include ok, 409, 422, 403 and network/unknown outcomes. The DTO fields remain defined by `LeadView` at `L274–289` and 1:1 API mapping at `L575–580`.

**Code:** `apps/admin-web/src/app/reviews/actions.ts:L166–171` revalidates only on success and must not be copied unchanged. `apps/admin-web/src/lib/api/reviews.ts:L175–185` has the different transitions/toStatus API. `apps/admin-web/src/lib/api/mutation.ts:L59–78` supports the requested form projection, including ok → success, also confirmed by a source-backed execution probe.

**Fix adopted:** explicit leads contract and unconditional post-attempt invalidation. No remaining plan fix required.

### 10. BLOCKING — Resolved: shared tuple and existing prop consumers covered

**Plan:** `L74–77,L739–744` locates the commerce tuple in the shared package, defines all three admin props, normalizes missing site type to `store` and failed settings reads to null, and names the omitted admin fixtures. `L914–916` specifies the storefront prop and updates the commerce fixture and every other existing Sections fixture to `store`.

**Code:** `packages/storefront-content/src/index.ts:L15` already re-exports `sections.ts`, so both apps can consume the new export. `apps/admin-web/src/lib/api/store-settings.ts:L16–17,L41–50` confirms optional site type and the result shape. The omitted consumers exist at `apps/admin-web/src/components/online-store/customize-editor.test.tsx:L81–84,L518–529`, `apps/admin-web/src/components/online-store/sections/section-tree-panel.test.tsx:L43–63` and `apps/storefront/src/components/sections/commerce-sections.test.tsx:L39–56`.

**Fix adopted:** shared package boundary, explicit fallbacks and fixture migration; no storefront import from admin-web. No remaining plan fix required.

### 11. OPTIONAL — Resolved: international `+` or `00` wording

**Plan:** `L370–371` supersedes D5's narrower sentence and adds the USD/`00201012345678` success oracle.

**Code:** `packages/tracking/src/pipeline/normalization.ts:L65–80` accepts `+` and `00` before consulting the calling code. Execution of that committed helper confirmed `00201012345678 → +201012345678` without a country default and rejection of a local-format number.

**Fix adopted:** document/test existing behavior, without altering the shared normalizer. No remaining plan fix required; severity stays OPTIONAL.

### 12. OPTIONAL — Resolved: byte-exact CSV oracle and all-column guarding

**Plan:** `L990–992` gives the complete expected cell `"'=HYPERLINK(""x"")"`, sends all eight columns through `csvCell`, adds message cases for `@`, tab, CR and a non-phone `+` expression, preserves a legitimate international phone, and keeps BOM/CRLF.

**Code:** `apps/admin-web/src/lib/orders/orders-csv.ts:L39–58` exports the guards, handles non-number-shaped `+`/`-` in one branch and doubles embedded quotes. Executing these exact committed helpers produced the amended byte oracle, guarded `@`, tab, CR, `+1+2` and `-1+2`, and retained `+201012345678` unchanged.

**Fix adopted:** correct the oracle and mandate central guarding across the export, not changes to the orders helper. No remaining plan fix required; severity stays OPTIONAL.

### 13. OPTIONAL — Resolved: runtime command, migration assertions and truthful local reporting

**Plan:** `L78–80,L507–510` documents the Windows guard limitation, requires a leads consistency block covering columns, forced RLS and the exact tenant predicate, and corrects the persistence-task install timeout to 1,700 seconds. `L644–646` adds the exact runtime composition-test command and RedisClaimLedger assertion. `L479–480` retains the DB suite and exported scanner commands; the amendment overrides blanket local all-pass expectations.

**Code:** `apps/runtime/src/composition.test.ts:L98–105` is the real lazy graph test to extend. `packages/db/src/schema-migration-consistency.test.ts:L580–598` has exact-column and both-policy-predicate assertions. `packages/db/src/prisma-tenant-where.guard.test.ts:L24–28` contains the file-URL dynamic import identified in round 1. This review does not claim the guard or future suites passed locally.

**Fix adopted:** executable verification instructions and a documented local exception, without weakening the guard. No remaining plan fix required; severity stays OPTIONAL.

### 14. OPTIONAL — Resolved: D4 regression and UI accessibility/test boundaries

**Plan:** `L372–374` requires decide-then-insert-failure coverage and a saved suppressed retry using the same session with a new submission key. `L745` mandates portal-wide assertions. `L919–921` puts the keyboard/autocomplete attributes and label on the honeypot input and focuses the status message after replacement.

**Code:** `services/leads/src/application/leads.use-cases.ts:L156–195` claims before inserting; `packages/tracking/src/leads/lead-emission.ts:L39–44,L71–76` keeps the atomic claim for its TTL, explaining the accepted suppressed retry. `apps/admin-web/src/components/online-store/sections/add-section-dialog.tsx:L16–20,L43–50` confirms the real portalled Dialog. Existing semantic-token/logical-property/bdi constraints remain at `Plan:L103–106`.

**Fix adopted:** explicit failure oracle, input-level honeypot attributes, label and intentional status focus; no reopening D4's accepted lost-claim trade-off. No remaining plan fix required; severity stays OPTIONAL.

## Verification and limits

- Executed committed-source Node probes for AppError/plain-Error mapping, international `00` normalization, local digit conversion, the exact CSV oracle and formula/phone cases, and mutation success projection. All assertions completed with exit 0. TypeScript was transpiled in memory; CSV helpers were selected from the committed source AST, with no rewritten helper logic, stubbed results, files or DB calls.
- Executed structural checks: plan text equals committed HEAD; Tasks 1–7 each have one amendment block; finding tags 1–14 and the precedence sentence are present. All assertions completed with exit 0.
- Not run: future-feature suites, concurrent Task 1 draft tests, package-wide tests/typechecks, installation, schema generation/migration, DB integration or `next build`. Approval concerns implementable amended contracts, not uncommitted implementation behavior.
- No additional contradiction remains that requires reopening an accepted decision. Findings 1–10 leave no plan blocker; findings 11–14 retain their OPTIONAL classification.

VERDICT: AGREED
