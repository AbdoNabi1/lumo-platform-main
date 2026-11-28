# Lead Site Part C — Lead Form, Leads Service and Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Ruling (owner, 2026-11-22):** "كمل" while Sol (reviewer-astra) and Terra are rate-limited (reset ~00:01): Part C
starts before Sol's round-1 plan review, on impl-sonnet. Sol reviews the plan and every finished task when it returns;
accepted findings go back as fix rounds (amendment blocks). Merge/push still need the owner's go-ahead.

**Status:** `OPUS: AGREED · Sol: AGREED (plan review 2, 2026-11-23)`

**Goal:** a lead website can place a lead form on its homepage; every valid submission is saved for the merchant and
reaches an admin "Leads" inbox (search, status, CSV); each saved lead records whether it must be sent to the ad
platforms (once per visitor session), ready for Plan D to send.

**Depends on:** Plan A merged into this branch (store settings `siteType`, tenancy `getPublicStore` exposing
`siteType`, admin-web `StoreSettingsDto.siteType`, storefront `getPublicStore().siteType`). Plan B (landed:
`decideLeadEmission`, `LeadEmissionLedgerPort`, `InMemoryLeadEmissionLedger`, `businessEventId`, `normalizePhone`,
`normalizeEmail`, `LEAD_CLAIM_TTL_SECONDS`, all exported from `@platform/tracking`).

**Spec:** `docs/superpowers/specs/2026-11-20-lead-site-and-tracking-design.md` (owner decisions 2–3, section
"Handoff to Plans C and D" as amended by this plan, see "Design decisions" D1).
Code facts used here: `C:/Users/Abdo/AppData/Local/hermes/cache/scratch/lead-site/survey-backend.md` and
`survey-frontend.md` (read-only surveys of this branch at `74f29a00`).

## Design decisions (Opus)

- **D1 — session identity lives on the merchant's own domain.** The collector's `morbeh_sid` is set on the collector
  host and is third-party on merchant custom domains, and no browser SDK exists yet. So the **storefront middleware**
  owns a first-party `morbeh_sid` cookie (same name and 30-minute sliding lifetime as the collector, not HttpOnly so
  Plan D's SDK can read it): read it or mint a UUID, and re-issue it with `Max-Age=1800` on every response.
  "Once per session" is then enforced by two layers:
  1. a cookie `morbeh_lead_sent=<sid>` (HttpOnly) that the lead action sets after a forwarded lead; while it equals
     the current `morbeh_sid` the next lead in that session is **suppressed** — this covers sessions longer than 30
     minutes without any per-page-view Redis call;
  2. the Redis claim `decideLeadEmission` (TTL 1800) for two submits racing before the cookie exists.
     A visitor can only cause _more_ forwarding by deleting cookies, which is the same as starting a new session (allowed
     by owner decision 2). `extendLeadClaim` stays unused by this plan. The spec handoff line "the collector calls
     `extendLeadClaim`" is replaced by this design (Task 5 edits the spec).
- **D2 — spam.** Honeypot field filled, or less than 3 000 ms between the form appearing and the submit → the lead is
  saved with status `spam` and is never forwarded. The visitor still sees success (bots learn nothing). Rate limits on
  the public route: 60 per 10 minutes per shop and 5 per 10 minutes per visitor IP (when an IP is provided); a limiter
  failure answers 503 (fail closed). These signals come from the storefront and can be forged by a caller that skips
  the storefront; the per-shop cap bounds that. Recorded as a known limit.
- **D3 — only lead sites take leads.** The public route answers `409 BUSINESS_RULE` for a shop whose site type is not
  `lead_site`; the storefront renders `lead_form` only on lead sites; the editor offers `lead_form` only to lead sites
  and hides the commerce sections (`featured_collection`, `featured_products`, `collection_list`) from lead sites.
- **D4 — tracking status on the lead.** `pending` (forward it — Plan D sends and moves it to `sent`/`failed`),
  `suppressed` (same session), `skipped_spam`. Event id `lead_<leadId>` (`businessEventId("lead", id)`) is stored on
  the row. Order: decide first, then save in one write. If the save fails after a successful claim, a retry in the same
  30 minutes is saved as `suppressed` (accepted: rare, and the claim never blocks saving).
- **D5 — phone.** The visitor's phone is stored as typed (trimmed) and as E.164 via `normalizePhone(phone, cc)` where
  `cc` comes from the shop currency: `EGP → "20"`, `SAR → "966"`, `AED → "971"`, otherwise none (then only `+…` input
  is accepted). An unparseable phone is a `422 VALIDATION` on field `phone`.
- **D6 — statuses.** `new` (default), `contacted`, `qualified`, `converted`, `rejected`, `spam`. The merchant may move
  a lead from any status to any other; the same status again is a no-op success. Qualified/Converted events to ad
  platforms are a later phase (spec).
- Out of scope (later plan; owner may reprioritise): hiding cart/product routes and the header cart on lead sites;
  click-id capture into first-party cookies (Plan D); sending to platforms (Plan D); the pending-owner staff sign-in gap.

## Amendments round 1 — precedence and shared rules (binding)

Precedence: **Amendments round 1 > original task text.** Every item is tagged `Plan review 1, finding N`
(review file `2026-11-22-lead-site-part-c-plan-review-1.md`). Task 1 is already committed (`5eefc1f9`); its amendment
block is a fix round on that code.

- **Shared rule — public idempotency is a lead column, not the transport cache (finding 6).** `POST /public/leads` is
  **not** `idempotent: true` (the transport snapshots every handler response for 24 h, including transient 429/503).
  Instead the request must carry header `Idempotency-Key` matching `^[A-Za-z0-9-]{8,128}$`; it is stored on the lead as
  `submissionKey` with a unique index `(tenant_id, submission_key)`. A repeat with the same key returns the stored
  lead's result (201, same body) without a new claim or row; rate-limit refusals and 503s are never stored, so the
  same key succeeds once the limiter recovers. The storefront form mints the key once per attempt (Task 6), so a
  double click or a retry reuses it.
- **Shared rule — commerce section list lives in the shared content package (finding 10).**
  `packages/storefront-content/src/sections.ts` exports
  `export const COMMERCE_SECTION_TYPES = ["featured_collection", "featured_products", "collection_list"] as const satisfies readonly SectionType[];`
  (Task 4 adds it; admin-web and storefront both import it from `@platform/storefront-content`).
- **Shared rule — known local failure.** `packages/db/src/prisma-tenant-where.guard.test.ts` fails on Windows because of
  the space in the path (Vite dynamic import of a file URL). Do not change it; report it as "known Windows path failure"
  and use the exported scanner command instead (finding 13).

## Implementers

Task 1 `impl-terra` · Task 2 `impl-sonnet` · Task 3 `impl-terra` · Task 4 `impl-sonnet` · Task 5 `impl-terra` ·
Task 6 `impl-sonnet` (UI) · Task 7 `impl-sonnet` (UI).

## Global Constraints

- Every command is printed in full and runs as is in bash from `cd 'F:/New folder/morbeh-lead-site'`; pnpm is always
  `node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs` (the shim fails in agent shells).
  Dependencies are installed; a task that **adds a workspace package or dependency** runs
  `node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs install --offline --no-frozen-lockfile`
  once (foreground, `timeout 600`).
- Commits: `git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit`, conventional type,
  **lowercase subject** (commitlint `subject-case`), trailer `Co-Authored-By: <the model that wrote it>`; run
  `git commit` in the foreground with a ≥400 s tool timeout (husky + lint-staged). Stage only the task's files. Never
  stash/checkout/reset/`--no-verify`; leave existing lint-staged backup stashes alone.
- Migrations hand-written and additive; never run `prisma migrate`/`db push`.
- Tenant always from `context.tenantId` / `currentShopId()`, never from a request body. Every Prisma read/update names
  `tenantId` in `where`; writes run in `runInTenantTransaction`, reads in `runReadScoped` (`packages/db/src/transaction.ts`).
- New test files start with `beforeEach(() => { expect.hasAssertions(); })`. In-memory async methods return
  `Promise.resolve(...)` instead of `async` without `await` (`require-await`).
- UI: semantic tokens only, `@platform/ui` components, Lucide icons, logical properties (`ms-*`, `text-start`), one
  `<h1>` per page, every input has a `<label>`; visitor-typed text in `<bdi dir="auto">`, phone/email in `dir="ltr"`;
  Arabic + English messages (both dictionaries; `ar` is typed against `en`). Rules: `docs/ui/README.md`,
  `docs/ui/MORBEH_DESIGN_SYSTEM.md`.
- Tool output may mask phone numbers as `+201****5678`; literal values in this plan are full numbers.

## Review Focus

1. A lead on a `store` shop is refused (409) and the form never renders there.
2. Same session: first valid lead `pending`, every later one `suppressed`, also after 30+ minutes of activity
   (cookie layer) and for two racing submits (claim layer); a new session id → `pending` again.
3. Spam (honeypot / too fast) is saved as `spam` + `skipped_spam`, the visitor sees success, nothing is claimed.
4. No cross-tenant read: list/get/export/status for shop A never see shop B's leads (in-memory and Prisma paths).
5. CSV cells from visitor text are formula-guarded (`guardCell`) and the file opens in Excel with Arabic (BOM).

---

### Task 1: `services/leads` core (domain, application, in-memory, controller)

**Files (create, copying the shape of `services/wishlist` and the newer idioms of `services/online-store`):**
`services/leads/package.json` (`@platform/leads`; deps: `@platform/application`, `@platform/contracts`, `@platform/domain`,
`@platform/repository`, `@platform/tracking`, `@platform/types`, `@platform/utils`; dev deps as wishlist),
`tsconfig.json`, `vitest.config.ts` (thresholds 85/85/85/80), `src/index.ts`, `src/domain/lead.ts`,
`src/domain/lead-repository.ts`, `src/application/ports.ts`, `src/application/leads.use-cases.ts`,
`src/infrastructure/in-memory-lead-repository.ts`, `src/interfaces/presenter.ts`, `src/interfaces/leads.controller.ts`,
`src/composition.ts` (in-memory branch only in this task; Task 2 adds Prisma), tests next to each.

**Interfaces (produced):**

```ts
// domain/lead.ts  (imports only @platform/types, @platform/utils, @platform/domain)
export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "converted",
  "rejected",
  "spam",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_TRACKING_STATUSES = [
  "pending",
  "suppressed",
  "skipped_spam",
  "sent",
  "failed",
] as const;
export type LeadTrackingStatus = (typeof LEAD_TRACKING_STATUSES)[number];
export interface LeadAttribution {
  readonly pageUrl: string | null;
  readonly referrer: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly cookies: {
    readonly fbp?: string;
    readonly fbc?: string;
    readonly ttp?: string;
    readonly scid?: string;
    readonly ga?: string;
  };
}
export interface LeadProps {
  readonly id: string;
  readonly formId: string;
  readonly name: string;
  readonly phone: string;
  readonly phoneE164: string;
  readonly email: string | null;
  readonly message: string | null;
  readonly status: LeadStatus;
  readonly trackingStatus: LeadTrackingStatus;
  readonly eventId: string;
  readonly sessionId: string;
  readonly spamReason: "honeypot" | "too_fast" | null;
  readonly attribution: LeadAttribution;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
export class Lead {
  static restore(props: LeadProps): Lead;
  readonly props: LeadProps;
  withStatus(status: LeadStatus, at: Date): Lead;
}
// withStatus: same status → returns this; else status changed, version + 1, updatedAt = at.

// domain/lead-repository.ts
export interface LeadListQuery {
  readonly first: number;
  readonly after?: string;
  readonly status?: LeadStatus;
  readonly search?: string;
  readonly createdFrom?: Date;
  readonly createdTo?: Date;
}
export interface LeadRepository {
  insert(tenantId: string, lead: Lead): Promise<void>;
  get(tenantId: string, id: string): Promise<Lead | null>;
  /** Optimistic: updates only if the stored version equals lead.version - 1; false otherwise. */
  updateStatus(tenantId: string, lead: Lead): Promise<boolean>;
  /** Newest first (id descending — ids are UUIDv7); `after` = the last id of the previous page; returns first+1 rows max. */
  list(tenantId: string, query: LeadListQuery): Promise<readonly Lead[]>;
}

// application/ports.ts
export type SiteType = "store" | "lead_site";
export interface ShopFactsPort {
  siteTypeOf(tenantId: string): Promise<SiteType>;
  currencyOf(tenantId: string): Promise<string>;
}
export { type LeadEmissionLedgerPort } from "@platform/tracking";

// application/leads.use-cases.ts
export const MIN_FILL_MS = 3000;
export const CURRENCY_CALLING_CODE: Readonly<Record<string, string>> = {
  EGP: "20",
  SAR: "966",
  AED: "971",
};
export interface SubmitLeadInput {
  readonly tenantId: string;
  readonly formId: string;
  readonly name: string;
  readonly phone: string;
  readonly email?: string;
  readonly message?: string;
  readonly sessionId: string;
  readonly sessionAlreadyEmitted: boolean;
  readonly spamSignals: { readonly honeypot: boolean; readonly elapsedMs: number };
  readonly context: Omit<LeadAttribution, never>;
}
export interface SubmitLeadOutput {
  readonly leadId: string;
  readonly eventId: string;
  readonly emission: "emit" | "suppressed" | "spam";
}
export class SubmitLead {
  constructor(deps: {
    leads: LeadRepository;
    ledger: LeadEmissionLedgerPort;
    shop: ShopFactsPort;
    clock: Clock;
    idGenerator: IdGenerator;
  });
  execute(input: SubmitLeadInput): Promise<Result<SubmitLeadOutput, DomainError>>;
}
export class ListLeads {
  execute(
    input: { tenantId: string } & Partial<Omit<LeadListQuery, "first">> & { first?: number },
  ): Promise<Result<Paginated<LeadView>, DomainError>>;
}
export class GetLead {
  execute(input: { tenantId: string; leadId: string }): Promise<Result<LeadView, DomainError>>;
}
export class ChangeLeadStatus {
  execute(input: {
    tenantId: string;
    leadId: string;
    status: LeadStatus;
  }): Promise<Result<LeadView, DomainError>>;
}
export class ListLeadExportRows {
  execute(input: {
    tenantId: string;
    first?: number;
    after?: string;
    status?: LeadStatus;
    createdFrom?: Date;
    createdTo?: Date;
  }): Promise<Result<Paginated<LeadView>, DomainError>>;
}
export interface LeadView {
  // explicit primitives, never the aggregate
  readonly id: string;
  readonly formId: string;
  readonly name: string;
  readonly phone: string;
  readonly phoneE164: string;
  readonly email: string | null;
  readonly message: string | null;
  readonly status: LeadStatus;
  readonly trackingStatus: LeadTrackingStatus;
  readonly eventId: string;
  readonly createdAt: string; // ISO
  readonly pageUrl: string | null;
  readonly referrer: string | null;
}
```

`SubmitLead.execute`, exact order:

1. Validate (all failures together, `ValidationError("Invalid lead", fields)`): `formId` `^[A-Za-z0-9_-]{1,64}$`;
   `name` trimmed 1–120; `phone` trimmed 1–32 and `normalizePhone(phone, CURRENCY_CALLING_CODE[await shop.currencyOf(t)])`
   defined (field `phone`, message `must be a valid phone number`); `email` absent/blank → `null`, else
   `normalizeEmail` defined (field `email`) and ≤320; `message` trimmed, blank → `null`, ≤2000; `sessionId`
   `^[A-Za-z0-9-]{1,64}$`; `elapsedMs` integer ≥ 0.
2. `await shop.siteTypeOf(tenantId) !== "lead_site"` → `BusinessRuleError("This shop does not take leads")`.
3. `id = idGenerator.generate()`, `eventId = businessEventId("lead", id)`.
4. Spam (`honeypot` true → `"honeypot"`, else `elapsedMs < MIN_FILL_MS` → `"too_fast"`): status `spam`,
   trackingStatus `skipped_spam`, emission `"spam"`, **no ledger call**.
5. Otherwise status `new`; `sessionAlreadyEmitted` → `suppressed` / `"suppressed"` with no ledger call; else
   `decideLeadEmission(ledger, { tenantId, sessionId })` → `"emit"` → `pending`, `"suppressed"` → `suppressed`.
6. `leads.insert(...)` with `createdAt = updatedAt = clock.now()`, `version 0`; return the output.

`ListLeads`: `first` default 20, max 100 (`normalizePageSize` semantics); `search` trimmed, blank → none, ≤100;
match = case-insensitive substring of `name` or `email`, or digits of the search (after `toLatinDigits`, at least 3
digits) as a substring of `phoneE164`. `ListLeadExportRows`: page size fixed 250. `pageInfo` from
`buildPaginatedPage` (`@platform/repository`), `endCursor` = last id. Unknown id → `NotFoundError`.
`ChangeLeadStatus`: `updateStatus` false → `ConcurrencyError`. Controller: `submit` → `present(result, 201)`,
others 200 (`presenter.ts` copied from wishlist). `composition.ts`: `wireLeads(deps: { clock; idGenerator; shop: ShopFactsPort; ledger?: LeadEmissionLedgerPort; prisma?: Database })`
returns `{ controller: LeadsController; drainOutbox: () => Promise<number>; deliveredEventTypes: readonly string[] }`
(`drainOutbox` resolves 0, `[]` — no events); absent `ledger` → `new InMemoryLeadEmissionLedger({ now: () => deps.clock.now().getTime() })`.

- [ ] **Step 1: Failing tests** (`leads.use-cases.test.ts` with the in-memory repo, a fake `ShopFactsPort`
      `{ siteTypeOf: async () => "lead_site", currencyOf: async () => "EGP" }`, fixed clock `2026-11-22T10:00:00.000Z`,
      sequential id generator returning UUIDv7-shaped ids `0193…-0001`, `0193…-0002`, … in ascending order):
  - valid lead (`name: "أحمد علي"`, `phone: "٠١٠١٢٣٤٥٦٧٨"`, `email: " A@B.com "`, session `s-1`, elapsed 8000) →
    `{ emission: "emit" }`, stored `phoneE164 "+201012345678"`, `email "a@b.com"`, status `new`, tracking `pending`,
    `eventId "lead_" + id`.
  - same session again → `suppressed`; `sessionAlreadyEmitted: true` with a fresh session → `suppressed` and the
    ledger was not called (spy); new session `s-2` → `emit`.
  - two concurrent submits in `s-9` → one `emit`, one `suppressed`.
  - honeypot → `spam` + `skipped_spam` + emission `"spam"`, ledger not called; elapsed 2999 → `too_fast`; elapsed 3000 → not spam.
  - `siteTypeOf → "store"` → error code `BUSINESS_RULE`, nothing stored.
  - validation: `phone: "123"` → `VALIDATION` with field `phone`; `email: "x@"` → field `email`; `name: "  "` → field
    `name`; `formId: "a b"` → field `formId`; all four at once → four fields.
  - currency `USD` + phone `01012345678` → field `phone`; currency `USD` + `+201012345678` → ok.
  - list: newest first, `first: 2` → 2 items + `hasNextPage true`; `after` = endCursor → the rest; `status: "spam"`
    filter; search `"أحمد"`, `"A@B"`, `"1234"` each find the lead, `"12"` (2 digits) matches by name/email only.
  - tenant isolation: a lead of `t-1` is invisible to list/get/status of `t-2` (`NOT_FOUND`).
  - change status `new → contacted` → version 1; same status again → unchanged, version 1; stale version → `CONCURRENCY`.
    Domain tests: `withStatus` same status returns the same instance; different → version+1, `updatedAt` = at.
    Controller test: submit → 201 body `{ leadId, eventId, emission }`; store shop → 409 envelope code `BUSINESS_RULE`.
- [ ] **Step 2: Run, expect FAIL** — first link the new package, then run:

```bash
cd 'F:/New folder/morbeh-lead-site' && timeout 600 node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs install --offline --no-frozen-lockfile
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/leads test
```

- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS** — the test command above, then:

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/leads typecheck
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/leads lint
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs arch
```

- [ ] **Step 5: Commit** (stage `services/leads/**` and `pnpm-lock.yaml`) `feat(leads): lead service core with once-per-session decision`.

**Amendments round 1 (binding) — fix round on `5eefc1f9`:**

- (finding 7) Keep the implemented local pure `toLatinDigits` in `services/leads/src/domain/lead-search.ts` and the
  `@platform/db` type-only dependency; both are now the plan. `src/index.ts` must export at least: `wireLeads`,
  `LeadsWiringDeps`, `WiredLeads`, `LeadsController`, `ControllerResponse`, `LEAD_STATUSES`, `LeadStatus`,
  `LEAD_TRACKING_STATUSES`, `LeadTrackingStatus`, `LeadAttribution`, `ShopFactsPort`, `SiteType`, `LeadView`,
  `SubmitLeadInput`, `SubmitLeadOutput`, `LeadRepository`, `LeadListQuery` (already true — keep).
- (finding 6) `LeadProps.submissionKey: string`; `SubmitLeadInput.submissionKey: string` (validated
  `^[A-Za-z0-9-]{8,128}$`, field `submissionKey`). `LeadRepository` gains
  `findBySubmissionKey(tenantId: string, submissionKey: string): Promise<Lead | null>` and `insert` now returns
  `Promise<"inserted" | "duplicate">` (`"duplicate"` = a row with the same `(tenantId, submissionKey)` exists).
  `SubmitLead.execute` order becomes: 1 validate → 2 site type → **2b `findBySubmissionKey`: found → return
  `ok({ leadId, eventId, emission })` from the stored row, where emission = `pending|sent|failed → "emit"`,
  `suppressed → "suppressed"`, `skipped_spam → "spam"` (no claim, no insert)** → 3 id → 4/5 spam/decision → 6 insert;
  `"duplicate"` → re-read with `findBySubmissionKey` and return that row's result. In-memory repo enforces the unique
  pair.
- (finding 11) D5 wording: without a calling code for the shop currency, only explicit international input (`+…` or
  `00…`) is accepted. Add tests: currency `USD` + `00201012345678` → ok, `phoneE164 "+201012345678"`.
- (finding 14) D4 regression test: a repository whose first `insert` rejects; submit with session `s-1` rejects; a
  second submit with `s-1` (new submission key) is saved with `trackingStatus "suppressed"`. Do not reorder save before
  decide.
- Tests for the submission key: same key twice → one row, identical outputs, ledger called once; same key after a
  spam submit → `"spam"` again, one row; two concurrent submits with one key → one row, both outputs equal.
- Commands: as Task 1 Step 4 (leads test, typecheck, lint, arch). Commit `fix(leads): idempotent lead submission by key`.

---

### Task 2: leads persistence (Prisma, RLS migration) and the Redis claim ledger

**Files:**

- Create: `packages/db/prisma/schema/leads.prisma`; `packages/db/prisma/schema/migrations/20261122000000_leads/migration.sql`
- Modify: `packages/db/prisma/schema/main.prisma` (append `"leads"` to `schemas = [...]`, line ~37);
  `packages/db/prisma/MIGRATIONS.md` (section 5 bullet, same format as the staff-directory bullets)
- Create: `services/leads/src/infrastructure/prisma-lead-repository.ts` (+ `rows.ts`, `lead.mapper.ts`, tests)
- Modify: `services/leads/src/composition.ts` (Prisma branch), `services/leads/package.json` (`@platform/db`, `@prisma/client`)
- Create: `packages/redis/src/claim-ledger.ts` (+ test); Modify: `packages/redis/src/index.ts`

**Interfaces:**

```prisma
model Lead {
  id             String   @id @db.Uuid
  tenantId       String   @map("tenant_id")
  formId         String   @map("form_id")
  name           String
  phone          String
  phoneE164      String   @map("phone_e164")
  email          String?
  message        String?
  status         String
  trackingStatus String   @map("tracking_status")
  eventId        String   @map("event_id")
  sessionId      String   @map("session_id")
  spamReason     String?  @map("spam_reason")
  attribution    Json     @default("{}")
  version        Int      @default(0)
  createdAt      DateTime @map("created_at")
  updatedAt      DateTime @map("updated_at")
  @@index([tenantId, id(sort: Desc)])
  @@index([tenantId, status, id(sort: Desc)])
  @@map("leads")
  @@schema("leads")
}
```

Migration (pattern of `20261016030000_staff_directory` + `20261027000000_online_store_identity`): `SET row_security = off;`
`CREATE SCHEMA IF NOT EXISTS "leads";` the table with the columns above (`TIMESTAMP(3)`, `JSONB NOT NULL DEFAULT '{}'`),
`CHECK ("status" IN ('new','contacted','qualified','converted','rejected','spam'))`,
`CHECK ("tracking_status" IN ('pending','suppressed','skipped_spam','sent','failed'))`,
`CHECK ("spam_reason" IS NULL OR "spam_reason" IN ('honeypot','too_fast'))`, the two indexes, `ENABLE` + `FORCE ROW
LEVEL SECURITY`, `DROP POLICY IF EXISTS tenant_isolation`, `CREATE POLICY tenant_isolation … FOR ALL USING (tenant_id =
current_setting('app.tenant_id', true)) WITH CHECK (…same…)`, `RESET row_security;`.

```ts
// packages/redis/src/claim-ledger.ts — structurally satisfies @platform/tracking's LeadEmissionLedgerPort
export class RedisClaimLedger {
  constructor(redis: Redis);
  /** SET key "1" EX ttl NX → true when Redis answers "OK". */ claimOnce(
    key: string,
    ttlSeconds: number,
  ): Promise<boolean>;
  /** EXPIRE key ttl — never creates a missing key. */ extend(
    key: string,
    ttlSeconds: number,
  ): Promise<void>;
}
```

`PrismaLeadRepository({ prisma })`: `insert` = `runInTenantTransaction(…, tx.lead.create({ data }))`; `get` =
`runReadScoped(…, findFirst({ where: { id, tenantId } }))`; `updateStatus` = `runInTenantTransaction(…,
updateMany({ where: { id, tenantId, version: lead.version - 1 }, data: { status, version, updatedAt } }))` → `count === 1`;
`list` = `findMany({ where: { tenantId, …(after ? { id: { lt: after } } : {}), …status, …createdAt range, …search OR },
orderBy: { id: "desc" }, take: first + 1 })` with search `OR: [{ name: { contains, mode: "insensitive" } },
{ email: { contains, mode: "insensitive" } }, { phoneE164: { contains: digits } }]` (digits clause only when ≥3 digits).
Mapper: unknown `status`/`trackingStatus`/`spamReason` → `throw new Error("leads.<column> is not valid: …")`.

- [ ] **Step 1: Failing tests** — `prisma-lead-repository.test.ts` with `createFakePrisma()` from `@platform/db/testing`
      (pattern `services/online-store/src/infrastructure/prisma-repositories.test.ts`): insert then get round-trips every
      field (attribution JSON included); `get` for another tenant → null; `updateStatus` with a stale version → false;
      list newest-first + `after` + status + search (name, email, ≥3 digits); mapper throws on `status: "x"`;
      every recorded call names `tenantId` in `where` and runs after `set_config('app.tenant_id', <tenant>)`.
      Rerun Task 1's use-case suite against the Prisma repository through the same fake (parametrise the suite over both
      repositories with `describe.each`). `claim-ledger.test.ts` with a fake ioredis (`set`/`expire` spies): `claimOnce`
      sends `("k", "1", "EX", 1800, "NX")` and maps `"OK" → true`, `null → false`; `extend` sends `("k", 1800)`.
- [ ] **Step 2: Run, expect FAIL**

```bash
cd 'F:/New folder/morbeh-lead-site' && timeout 600 node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs install --offline --no-frozen-lockfile
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/leads test
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/redis test
```

- [ ] **Step 3: Implement**, then validate/generate the schema:

```bash
cd 'F:/New folder/morbeh-lead-site' && DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy DIRECT_URL=postgresql://dummy:dummy@localhost:5432/dummy node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/db exec prisma validate
cd 'F:/New folder/morbeh-lead-site' && DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy DIRECT_URL=postgresql://dummy:dummy@localhost:5432/dummy node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/db exec prisma generate
```

- [ ] **Step 4: Run, expect PASS** — the three Step 2 test commands, then:

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/leads typecheck
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/redis typecheck
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/db test
cd 'F:/New folder/morbeh-lead-site' && node -e "import('./scripts/dev/check-prisma-tenant-where.mjs').then(async m=>console.log(JSON.stringify(await m.scanPrismaTenantWhere(process.cwd()))))"
```

Expected: all pass; no tenant-where finding under `services/leads`.

- [ ] **Step 5: Commit** `feat(leads): persist leads with row level security and a redis claim ledger`.

**Amendments round 1 (binding):**

- (finding 6) Prisma model and migration gain `submissionKey String @map("submission_key")` /
  `"submission_key" TEXT NOT NULL`, unique index `leads_tenant_id_submission_key_key` on `(tenant_id, submission_key)`
  (`@@unique([tenantId, submissionKey])`). `insert` maps Prisma `P2002` on that index (use `isUniqueViolation` as in
  `services/online-store/src/infrastructure/rows.ts`) to `"duplicate"`; `findBySubmissionKey` = `runReadScoped` +
  `findFirst({ where: { tenantId, submissionKey } })`.
- (finding 1) Do **not** use `createFakePrisma()` for list/search semantics (it rejects `OR`, has no `contains`/`mode`
  and ignores `orderBy`). Instead:
  1. `prisma-lead-repository.test.ts` uses a **recording client** defined in that file:
     `function recordingPrisma(results: Partial<Record<string, unknown[]>>)` returning
     `{ prisma, calls }` where `calls: { model: string; method: string; args: unknown }[]` records every delegate call
     and every `$executeRaw` as `{ model: "$raw", method: "executeRaw", args: <the tenant id value> }`, and
     `prisma.$transaction(fn)` calls `fn` with the same client; each delegate method returns the next queued value from
     `results["<model>.<method>"]` (default `null` / `{ count: 0 }` / `[]` by method kind). Tests assert the exact `args`
     of each query (the `where` with `tenantId`, the `OR` search clause, `orderBy: { id: "desc" }`, `take: first + 1`,
     the `lt` cursor, the date range, the `version` guard) and that the `$raw` set_config call precedes each query.
  2. `prisma-lead-repository.integration.test.ts`, skipped unless `DATABASE_URL_TEST` is set (pattern of the existing
     `*.integration.test.ts` files), runs the Task 1 use-case suite (`describe.each` over in-memory and Prisma) against a
     real database. Semantics are proven by the in-memory suite locally and by this suite in CI.
- (finding 13) Add a leads block to `packages/db/src/schema-migration-consistency.test.ts` following its existing
  per-schema blocks (~580–598): every model column exists in the migration, `FORCE ROW LEVEL SECURITY`, and the exact
  `tenant_isolation` predicate. Report the guard-test Windows failure as known (preamble).
- (finding 13) Install command timeout: `timeout 1700` (not 600) for `install --offline --no-frozen-lockfile`.
- Commit unchanged.

---

### Task 3: admin wiring — public submit route, inbox routes, permissions, runtime ledger

**Files:**

- Modify: `apps/admin/package.json` (`@platform/leads`, `@platform/tracking`), `apps/admin/src/composition.ts`
  (import; `WiredAdmin.leads`; `publicReads.leads`; `const leads = wireLeads({ clock, idGenerator, prisma, ledger: deps.leadEmissionLedger, shop })`;
  add `leads` to `contexts`; `AdminWiringDeps.leadEmissionLedger?: LeadEmissionLedgerPort`)
- Create: `apps/admin/src/interfaces/leads.admin-controller.ts`, `apps/admin/src/http/leads-routes.ts`,
  `apps/admin/src/http/public-leads-routes.ts` (+ tests)
- Modify: `apps/admin/src/http/admin-routes.ts` (imports + spreads next to wishlist), `apps/admin/src/http/server.ts`
  (`AdminHttpDeps.leadEmissionLedger?`, passed to `wireAdmin`)
- Modify: `apps/runtime/src/composition.ts` (`leadEmissionLedger: new RedisClaimLedger(redis.client)` next to the
  rate limiter, line ~419), `apps/runtime/src/api.ts` (pass it to `createAdminHttpApi`, line ~518), `apps/runtime/package.json` if needed
- Modify: `packages/auth/src/role-table-access-control.ts` (`"leads"` in `SHOP_RESOURCES`) + its test;
  `scripts/ops/seed-ory-network.mjs` (`leads:read`, `leads:update`, `leads:export`); `apps/e2e/scripts/seed-e2e-identities.mjs`

**Interfaces:**

- `shop: ShopFactsPort` built in composition from the tenancy controller: `siteTypeOf` = `getPublicStore(tenantId)`
  body `siteType` (Plan A), `currencyOf` = same body `currency`; a non-200 → throw (the route answers 503 via the
  transport's error mapping).
- Public route `POST /public/leads` (`public: true`, `idempotent: true`, `permission: "leads:create"`), body (zod, `.strict()`):

```ts
const submitLeadBody = z
  .object({
    formId: z.string().min(1).max(64),
    name: z.string().min(1).max(120),
    phone: z.string().min(1).max(32),
    email: z.string().max(320).optional(),
    message: z.string().max(2000).optional(),
    sessionId: z.string().min(1).max(64),
    sessionAlreadyEmitted: z.boolean(),
    spamSignals: z.object({ honeypot: z.boolean(), elapsedMs: z.number().int().min(0) }).strict(),
    context: z
      .object({
        pageUrl: z.string().max(2048).nullable(),
        referrer: z.string().max(2048).nullable(),
        ip: z.string().max(64).nullable(),
        userAgent: z.string().max(512).nullable(),
        cookies: z
          .object({
            fbp: z.string().max(512).optional(),
            fbc: z.string().max(512).optional(),
            ttp: z.string().max(512).optional(),
            scid: z.string().max(512).optional(),
            ga: z.string().max(512).optional(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
```

Before the use case: `rateLimiter.consume(\`rl:${tenantId}:leads\`, 60, 600_000)` and, when `context.ip` is non-null,
  `rateLimiter.consume(\`rl:${tenantId}:leads:${context.ip}\`, 5, 600_000)`; denied → `rateLimited(...)`429; thrown →
  503 (copy`refuseUnlock`/`limiterUnavailable`from`public-online-store-routes.ts`); no limiter configured → skip.
  Response 201 `{ leadId, eventId, emission }`.

- Admin routes (permission strings identical in route and `LeadsAdminController`): `GET /leads` (`leads:read`,
  query `pageQuery.extend({ status: z.enum(LEAD_STATUSES).optional(), search: z.string().max(100).optional() })`,
  `first` ≤100), `GET /leads/:leadId` (`leads:read`), `POST /leads/:leadId/status` (`leads:update`, `idempotent: true`,
  body `{ status: z.enum(LEAD_STATUSES) }.strict()`), `GET /leads/export-rows` (`leads:export`, query
  `{ after?, status?, createdFrom?: z.coerce.date(), createdTo?: z.coerce.date() }`). Responses map `LeadView` 1:1;
  pages via `mapPage`.

- [ ] **Step 1: Failing tests**
  - `public-leads-routes.test.ts` (real server harness used by `server.multi-tenant.test.ts`): a lead-site shop
    (seed site type through Plan A's `settleSignupSiteType`) → 201 with `emission "emit"`, then same `sessionId` → 201
    `"suppressed"`; a store shop → 409 `BUSINESS_RULE`; body with `tenantId` → 422 `VALIDATION`; missing `sessionId` →
    422; the 6th submit from one IP in 10 min → 429 with `retry-after`; a limiter that throws → 503; replay with the
    same `Idempotency-Key` → identical 201 body and one stored lead.
  - `leads-routes.test.ts`: operator lists, reads, changes status, exports; viewer lists and reads but gets 403 on
    status and export-rows; shop A's token never sees shop B's lead (list, get → 404, status → 404, export).
  - `role-table-access-control.test.ts`: operator has `leads:update` and `leads:export`; viewer has `leads:read` only.
  - runtime: the composition test (or a new one next to it) asserts `leadEmissionLedger` is a `RedisClaimLedger`.
- [ ] **Step 2: Run, expect FAIL**

```bash
cd 'F:/New folder/morbeh-lead-site' && timeout 600 node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs install --offline --no-frozen-lockfile
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin exec vitest run src/http/public-leads-routes.test.ts src/http/leads-routes.test.ts
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/auth test
```

- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS** — the Step 2 test commands, then:

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin test
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin typecheck
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/runtime typecheck
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs arch
```

(`apps/runtime/src/kafka-topics/topic-inventory.test.ts` already fails before this work — unrelated; leads publish no events.)

- [ ] **Step 5: Commit** `feat(admin): lead submission and inbox api`.

**Amendments round 1 (binding):**

- (finding 2) The `ShopFactsPort` adapter in `apps/admin/src/composition.ts` throws
  `new AppError("shop facts unavailable", { code: "UNAVAILABLE" })` (`AppError` from `@platform/utils`) when the tenancy
  call rejects **or** answers non-200 or a body without a known `siteType`/string `currency`; the transport maps it to
  503 with no details. Tests: tenancy read rejects → 503, no insert and no claim; non-200 → 503, same.
- (finding 5) Inside the handler: `const tenantId = context.tenantId; const visitorIp = body.context.ip;` Keys
  `` `rl:${tenantId}:leads` `` (60 / 600 000 ms) and, only when `visitorIp !== null`,
  `` `rl:${tenantId}:leads:ip:${visitorIp}` `` (5 / 600 000 ms). Never use the transport `context.ip`. The limiter is
  **required**: `rateLimiter` undefined → 503 (`limiterUnavailable`), limiter throws → 503, denied → 429 with
  `retry-after` (copy `rateLimited` from `rate-limited-response.ts`). Tests: two visitor IPs behind one transport IP have
  separate 5-buckets; `ip: null` uses only the shop key; buckets are tenant-separated; the 61st shop submission with
  distinct IPs → 429; missing limiter → 503; throwing limiter → 503.
- (finding 6) The route is **not** `idempotent: true`. The handler reads `Idempotency-Key` from `context.headers`
  (case-insensitive); missing/invalid → 422 `VALIDATION` with field `Idempotency-Key`; passes it as `submissionKey`.
  Tests: same key twice → identical 201 bodies and **one** stored row (count via `GET /leads`); after a throwing limiter
  (503) the same key succeeds once the limiter recovers; concurrent same-key requests → one row.
- (finding 8) Harnesses:
  1. **New** `apps/admin/src/http/testing/leads-harness.ts`, modelled on `testing/online-store-harness.ts` (role
     tokens `admin|operator|viewer`, `RoleTableAccessControl`, persistent `responseCache`/claims, `countingLimiter()`),
     exporting `buildLeadsApp(options: { siteType?: "store" | "lead_site"; currency?: string; rateLimiter?: RateLimiter | null; shopFactsFail?: "reject" | "non-200" })`.
     It injects a `ShopFactsPort` through a new optional `AdminHttpDeps.leadsShopFacts?: ShopFactsPort` (passed to
     `wireAdmin`; when absent the tenancy-backed adapter is used). Used for: RBAC (viewer 403 on status/export-rows),
     limiter, idempotency, 503 paths.
  2. **Real path** in a new `apps/admin/src/http/leads-isolation.e2e.test.ts` reusing the multi-tenant `boot()` and
     sign-up helpers of `merchant-onboarding-isolation.e2e.test.ts` (extract them into
     `apps/admin/src/http/testing/multi-tenant-signup.ts` and import from both files): sign up shop A as `lead_site`
     and shop B as `store` through `/public/merchant-signup`; A takes a lead (201), B → 409 `BUSINESS_RULE`; A's owner
     token lists A's lead, B's token sees none and gets 404 for A's lead id; a request with B's token and a forged
     `x-tenant-id: <A>` never reads A's leads. No public site-type mutation is added.
- (finding 13) Add the runtime test command:
  `cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/runtime exec vitest run src/composition.test.ts`
  and assert there that the composed `leadEmissionLedger` is a `RedisClaimLedger`.

---

### Task 4: the `lead_form` section type and editor gating by site type

**Files:**

- Modify: `packages/storefront-content/src/limits.ts` (`leadFormPerPage: 1`, `leadSuccess: 200`), `sections.ts`
  (`SECTION_TYPES` + `"lead_form"`, `LeadFormSettings`, `SettingsByType`, `const leadForm = define(...)`,
  `SECTION_DEFINITIONS`), `public-sections.ts` (`PublicSettingsByType.lead_form`)
- Modify: `services/online-store/src/application/section-resolution.ts` (`case "lead_form"`)
- Modify: `apps/storefront/src/lib/public-sections.ts` (`case "lead_form"` in `settingsOf`)
- Create: `apps/admin-web/src/lib/online-store/section-availability.ts` (+ test)
- Modify: `apps/admin-web/src/app/online-store/themes/customize/page.tsx` (fetch store settings in the existing
  `Promise.all`, pass `siteType`), `components/online-store/customize-editor.tsx` → `sections/section-tree-panel.tsx` →
  `sections/add-section-dialog.tsx` (thread `siteType`, filter the list)
- Modify: `apps/admin-web/src/messages/en.ts` + `ar.ts` (`onlineStoreSections.descriptions.lead_form`;
  `onlineStoreSections.fields.submitLabel|successMessage|showEmail|showMessage`)
- Tests: `sections.test.ts` (per-type cap table, labels, defaults, label + `SECTION_LIMITS` snapshots),
  `theme-document.test.ts` (2nd `lead_form` → `TOO_MANY_OF_TYPE`), `section-resolution.test.ts`,
  `apps/storefront/src/lib/public-sections.test.ts`, `add-section-dialog.test.tsx`, `fields.test.tsx`

**Interfaces:**

```ts
export interface LeadFormSettings {
  // key order = fields order = defaults order
  readonly heading: LT;
  readonly text: LT;
  readonly submitLabel: LT;
  readonly successMessage: LT;
  readonly showEmail: boolean;
  readonly showMessage: boolean;
}
// define({ type: "lead_form", labels: { en: "Lead form", ar: "فورم العملاء" }, icon: "message-circle",
//   placement: "homepage", maxPerPage: L.leadFormPerPage, fields: [heading, localized("text", L.ctaText),
//   localized("submitLabel", L.buttonLabel), localized("successMessage", L.leadSuccess),
//   { kind: "boolean", key: "showEmail" }, { kind: "boolean", key: "showMessage" }],
//   defaults: () => ({ heading: { ar: "اطلب استشارة", en: "Get in touch" },
//     text: { ar: "سيب بياناتك وهنكلمك في أقرب وقت", en: "Leave your details and we will call you back" },
//     submitLabel: { ar: "ابعت", en: "Send" }, successMessage: { ar: "وصلتنا بياناتك، هنتواصل معاك قريب", en: "Thanks! We will contact you soon" },
//     showEmail: true, showMessage: true }) })
// PublicSettingsByType.lead_form = { heading: LT; text: LT; submitLabel: LT; successMessage: LT; showEmail: boolean; showMessage: boolean }

// admin-web lib/online-store/section-availability.ts
export const COMMERCE_SECTION_TYPES: readonly SectionType[] = [
  "featured_collection",
  "featured_products",
  "collection_list",
];
export function sectionTypeAllowed(
  type: SectionType,
  siteType: "store" | "lead_site" | null,
): boolean;
// lead_site → every type except COMMERCE_SECTION_TYPES; "store" or null → every type except "lead_form"
```

Backend and storefront resolution: `lead_form` is always complete (no reference fields): map each localized field with
`textOf`/`r.text` and the booleans with `r.value` (`true` unless the stored value is exactly `false`). Existing
sections already stored on a page are never removed by the editor filter (only the "Add" list is filtered).
Arabic descriptions: `lead_form`: `"فورم بيجمع اسم العميل وتليفونه (وإيميله ورسالته لو حبيت) ويوصلك في صندوق الليدز"`;
English: `"A form that collects a visitor's name and phone (and optionally email and message) into your Leads inbox"`.
Field labels: ar `submitLabel "نص زرار الإرسال"`, `successMessage "رسالة النجاح"`, `showEmail "اطلب الإيميل"`,
`showMessage "اطلب رسالة"`; en `"Submit button text"`, `"Success message"`, `"Ask for email"`, `"Ask for a message"`.

- [ ] **Step 1: Failing tests** — the listed suites gain: `lead_form` in the type list and label snapshot; cap 1;
      defaults equal the literal above; resolution returns the six settings (`showEmail: false` kept as false, a missing
      boolean → true); `sectionTypeAllowed` table (`lead_form`/`featured_products`/`hero` × `store`/`lead_site`/`null`);
      add dialog with `siteType "lead_site"` lists "Lead form" and not "Featured products"; with `"store"` the reverse.
- [ ] **Step 2: Run, expect FAIL**

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/storefront-content test
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/online-store exec vitest run src/application/section-resolution.test.ts
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter storefront exec vitest run src/lib/public-sections.test.ts
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web exec vitest run src/lib/online-store src/components/online-store/sections
```

- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS** — the Step 2 commands, then:

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/storefront-content typecheck
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/online-store typecheck
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter storefront typecheck
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web typecheck
```

- [ ] **Step 5: Commit** `feat(online-store): lead form section offered to lead sites only`.

**Amendments round 1 (binding):**

- (finding 10) `COMMERCE_SECTION_TYPES` is exported from `packages/storefront-content/src/sections.ts` (preamble), not
  from admin-web; `section-availability.ts` imports it. Prop contracts: `CustomizeEditor`, `SectionTreePanel`,
  `AddSectionDialog` each gain `readonly siteType: "store" | "lead_site" | null`. `customize/page.tsx` normalises the
  store-settings read: outcome ok → `settings.siteType ?? "store"`, any other outcome → `null`. Update the existing
  fixtures `components/online-store/customize-editor.test.tsx` (~83, ~522) and
  `components/online-store/sections/section-tree-panel.test.tsx` (~48–53) with `siteType: "store"`.
- (finding 14) Add-dialog tests query `screen`/`document.body` (the dialog is portalled), never `container`.

---

### Task 5: storefront server side — visitor session cookie, lead action, runtime call

**Files:**

- Create: `apps/storefront/src/lib/visitor-session.ts` (+ test)
- Modify: `apps/storefront/src/middleware.ts` (rename the current body to `async function route(request)`;
  `export async function middleware(request) { return withVisitorSession(request, await route(request)); }`)
- Create: `apps/storefront/src/app/(store)/lead-actions.ts` (+ `lead-actions.test.ts`)
- Modify: `apps/storefront/src/lib/runtime-api.ts` (`createLead`) + `runtime-api.calls.test.ts`;
  `apps/storefront/src/lib/request-locale.ts` (`export const getRequestPublicStore = cache(getPublicStore)`)
- Modify: `docs/superpowers/specs/2026-11-20-lead-site-and-tracking-design.md` (replace the "collector calls
  `extendLeadClaim`" sentence with design D1 of this plan)

**Interfaces:**

```ts
// lib/visitor-session.ts
export const VISITOR_SESSION_COOKIE = "morbeh_sid";
export const LEAD_SENT_COOKIE = "morbeh_lead_sent";
export const VISITOR_SESSION_TTL_SECONDS = 1800; // test: === LEAD_CLAIM_TTL_SECONDS from @platform/tracking
export function isSessionId(value: string | undefined): value is string; // /^[A-Za-z0-9-]{1,64}$/
export function withVisitorSession(request: NextRequest, response: NextResponse): NextResponse;
//   sid = cookie value if isSessionId, else crypto.randomUUID(); response.cookies.set(VISITOR_SESSION_COOKIE, sid,
//   { path: "/", maxAge: 1800, sameSite: "lax", secure: process.env.NODE_ENV === "production", httpOnly: false }); return response.

// lib/runtime-api.ts
export interface CreateLeadBody {
  /* exactly the Task 3 zod body */
}
export interface CreateLeadResult {
  readonly leadId: string;
  readonly eventId: string;
  readonly emission: "emit" | "suppressed" | "spam";
}
export function createLead(
  body: CreateLeadBody,
  idempotencyKey: string,
): Promise<{ status: number; body: CreateLeadResult | null }>;
//   postItem("/api/v1/public/leads", body, { "Idempotency-Key": idempotencyKey })

// app/(store)/lead-actions.ts  ("use server")
export interface LeadFormInput {
  readonly formId: string;
  readonly name: string;
  readonly phone: string;
  readonly email?: string;
  readonly message?: string;
  readonly honeypot: string;
  readonly elapsedMs: number;
}
export type LeadSubmissionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "validation";
      readonly fields: readonly ("name" | "phone" | "email" | "message")[];
    }
  | { readonly ok: false; readonly reason: "rate_limited" | "unavailable" | "network" };
export async function submitLead(input: LeadFormInput): Promise<LeadSubmissionResult>;
```

`submitLead`: read `morbeh_sid` (invalid/missing → mint `crypto.randomUUID()` and set it with the same options);
`sessionAlreadyEmitted = cookies LEAD_SENT_COOKIE === sid`; context: `pageUrl` = `referer` header, `referrer` = null
(the page's own referrer is unknown server-side), `ip` = first entry of `x-forwarded-for` trimmed (else null),
`userAgent` = `user-agent` header (≤512), cookies `_fbp`, `_fbc`, `_ttp`, `_scid`, `_ga` when present (each ≤512);
`spamSignals = { honeypot: input.honeypot.trim() !== "", elapsedMs: Math.max(0, Math.round(input.elapsedMs)) }`;
`createLead(body, crypto.randomUUID())`. 201 → if `emission !== "spam"` set `LEAD_SENT_COOKIE = sid` (`httpOnly: true`,
`maxAge: 86400`, path `/`, lax, secure in production) → `{ ok: true }`. 422 → `validation` with the envelope's
`fields[].field` values that are one of the four names; 429 → `rate_limited`; 409 or 503 → `unavailable`; anything
else / status 0 → `network`.

- [ ] **Step 1: Failing tests**
  - `visitor-session.test.ts`: existing valid sid is re-issued unchanged with max-age 1800 and not HttpOnly; missing
    or `"bad id!"` → a new UUID; TTL equals `LEAD_CLAIM_TTL_SECONDS`.
  - middleware test (existing middleware suite): a normal page response carries `Set-Cookie: morbeh_sid=…; Max-Age=1800`;
    a redirect from the lock gate also carries it.
  - `lead-actions.test.ts` (mock `@/lib/runtime-api` and `next/headers` like `products/[slug]/actions.test.ts`):
    body sent equals the expected object for given cookies/headers (`x-forwarded-for: "203.0.113.7, 10.0.0.1"` →
    `ip "203.0.113.7"`); `morbeh_lead_sent` equal to sid → `sessionAlreadyEmitted: true`, different → false;
    201 `emit` sets `morbeh_lead_sent=<sid>` HttpOnly; 201 `spam` sets nothing and returns `{ ok: true }`;
    422 with fields phone+email → `{ reason: "validation", fields: ["phone","email"] }`; 429/409/503/500/0 mapping.
  - `runtime-api.calls.test.ts`: `createLead` POSTs `/api/v1/public/leads` with `x-tenant-id`, JSON body and `Idempotency-Key`.
- [ ] **Step 2: Run, expect FAIL**

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter storefront exec vitest run src/lib/visitor-session.test.ts src/middleware.test.ts "src/app/(store)/lead-actions.test.ts" src/lib/runtime-api.calls.test.ts
```

(If the middleware suite has another file name, use `ls apps/storefront/src/*.test.ts` and name it in the report.)

- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS** — the Step 2 command, then:

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter storefront test
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter storefront typecheck
```

- [ ] **Step 5: Commit** `feat(storefront): visitor session cookie and lead submission action`.

**Amendments round 1 (binding):**

- (finding 3) `createLead(body, idempotencyKey)` returns `Promise<{ readonly status: number; readonly body: unknown }>`.
  The same module exports guards `isCreateLeadResult(value: unknown): value is CreateLeadResult` and
  `validationFieldsOf(value: unknown): readonly string[]` (reads `fields[].field` strings from an error envelope, else
  `[]`). `submitLead`: 201 with a body failing `isCreateLeadResult` → `network` and no cookie. Tests cover a real 422
  envelope and a malformed 201 body.
- (finding 4) The sent marker slides with the session: `withVisitorSession` also re-issues `morbeh_lead_sent` with the
  same value and `Max-Age=1800` (HttpOnly, lax, secure in production) **when its value equals the current sid**, and
  deletes it (`maxAge: 0`) when it names a different sid or the sid was just minted. `submitLead` sets it with
  `maxAge: 1800` (not 86 400). Tests with a cookie jar and clock: activity every 25 min for 25 h keeps the marker →
  `sessionAlreadyEmitted: true`; 31 idle minutes (new sid) → marker removed → `false`.
- (finding 6) `LeadFormInput` gains `submissionKey: string`; `submitLead` passes it as the `Idempotency-Key` (no
  `crypto.randomUUID()` in the action).

---

### Task 6: storefront lead form UI and site-type rendering (UI)

**Files:**

- Create: `apps/storefront/src/components/sections/lead-form.tsx` (server wrapper, like `whatsapp-cta.tsx`),
  `apps/storefront/src/components/sections/lead-form-fields.tsx` (`"use client"`, modelled on `write-review-form.tsx`)
- Modify: `apps/storefront/src/components/sections/sections.tsx` (`HANDLED`, `contentOf`, `headingIdOf`; new prop
  `siteType: "store" | "lead_site"` on `Sections`: skip `lead_form` unless `lead_site`; skip `COMMERCE_SECTION_TYPES`
  when `lead_site`), `apps/storefront/src/app/(store)/page.tsx` (read `getRequestPublicStore()`; `null` → `"store"`)
- Modify: `apps/storefront/src/messages/en.ts` + `ar.ts` (`leadForm` block)
- Tests: `components/sections/content-sections.test.tsx`, `sections.test.tsx`, new `lead-form-fields.test.tsx`

**Behaviour:** fields Name (`name`, required, `dir="auto"`, `autoComplete="name"`), Phone (`tel`, required, `dir="ltr"`,
`inputMode="tel"`, `autoComplete="tel"`), Email (only when `showEmail`, `type="email"`, `dir="ltr"`), Message (only when
`showMessage`, `<textarea>` `dir="auto"`, max 2000). A honeypot input `name="website"` inside a wrapper with the
`sr-only` class, `aria-hidden="true"`, `tabIndex={-1}`, `autoComplete="off"`. `elapsedMs` = `Date.now()` at submit minus
the time recorded in `useEffect` on mount. Submit via `useTransition` → `submitLead({ formId: section.id, … })`.
Success → the form is replaced by `<p role="status">` with `successMessage` (locale text via `pickText`, fallback
`t.leadForm.successDefault`). Failure → `<p role="alert">`: validation lists the invalid field labels, others use
`t.leadForm.errors.{rateLimited|unavailable|network}`; field errors set `aria-invalid` and `aria-describedby`. Submit
button `BUTTON_CLASS.primary`, disabled while pending, label `<bdi dir="auto">`. Arabic copy: name `"الاسم"`, phone
`"رقم التليفون"`, email `"الإيميل (اختياري)"`, message `"رسالتك (اختياري)"`, successDefault `"وصلتنا بياناتك، هنتواصل معاك قريب"`,
validation `"راجع البيانات دي: {fields}"`, rateLimited `"بعت كتير في وقت قصير، جرّب كمان شوية"`, unavailable
`"الفورم مش متاح دلوقتي"`, network `"حصلت مشكلة في الاتصال، جرّب تاني"`; English equivalents.

- [ ] **Step 1: Failing tests** — renders the configured fields only; RTL (`dir` attributes as above); honeypot is
      hidden from assistive tech and keyboard; a submit sends `formId = section.id` and `elapsedMs ≥ 0` (mock the action);
      success shows `role="status"`; validation `["phone"]` shows the phone label in the alert and `aria-invalid` on
      phone; `Sections` with `siteType "store"` drops a `lead_form` section and keeps `featured_products`; with
      `"lead_site"` the reverse; `page.tsx` passes `"store"` when the public store read fails.
- [ ] **Step 2: Run, expect FAIL**

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter storefront exec vitest run src/components/sections
```

- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS** — the Step 2 command, then:

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter storefront test
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter storefront typecheck
```

- [ ] **Step 5: Commit** `feat(storefront): lead form section`.

**Amendments round 1 (binding):**

- (finding 10) `Sections` prop: `readonly siteType: "store" | "lead_site"`. Import `COMMERCE_SECTION_TYPES` from
  `@platform/storefront-content`. Update `components/sections/commerce-sections.test.tsx` (~47) and every other existing
  `<Sections …>` fixture with `siteType: "store"`.
- (finding 6) The client form keeps `submissionKey` in state, minted with `crypto.randomUUID()` on mount and after
  each **successful** submit; a failed submit keeps the same key for the retry.
- (finding 14) The honeypot input itself carries `tabIndex={-1}`, `autoComplete="off"` and a `<label>` ("Website"),
  inside the `sr-only` + `aria-hidden="true"` wrapper. After success, focus moves to the `role="status"` message
  (`tabIndex={-1}` + `focus()`), so focus never stays on the removed button.

---

### Task 7: admin-web Leads inbox (UI)

**Files (create unless noted; patterns from the frontend survey §5):**
`apps/admin-web/src/lib/api/leads.ts` (+ test; copy `lib/api/reviews.ts`), `apps/admin-web/src/lib/leads/leads-csv.ts`
(+ test; reuse `csvCell`/`guardCell` exported from `lib/orders/orders-csv.ts` — export them if not exported),
`apps/admin-web/src/app/leads/page.tsx`, `app/leads/[leadId]/page.tsx`, `app/leads/actions.ts`,
`app/leads/export/route.ts` (+ tests), `components/leads/{leads-table,lead-status-badge,leads-toolbar,leads-pagination,lead-status-form}.tsx`
(+ tests). Modify: `components/navigation.ts` (+ test), `middleware.ts` `ROUTE_ROLE_REQUIREMENTS`
(`["/leads", "viewer"]`), `messages/en.ts` + `ar.ts` (`nav.leads`, `leadsPage`, `leadStatus`, `leadDetail`, `leadsExport`).

**Behaviour:**

- Nav: `{ id: "leads", label: (t) => t.nav.leads, href: "/leads", Icon: InboxIcon }` in `PRIMARY_NAV` after customers
  (shown to every shop in this plan; hiding it for stores is a later polish item).
- List `/leads?q=&status=&after=&stack=`: page size 20; toolbar with debounced (350 ms) search (copy `orders-toolbar.tsx`)
  and a status select whose options are "All" (the default; sends no `status`) followed by the six statuses (each
  sends `status=<value>`). Table columns: date (`Intl` via `lib/format.ts`), name `<bdi dir="auto">`, phone `<bdi dir="ltr">`
  (`phone` as typed), email `<bdi dir="ltr">`, message excerpt (first 80 chars, `<bdi dir="auto">`), status badge
  (`new → neutral`, `contacted → warning`, `qualified → success`, `converted → success`, `rejected → outline`,
  `spam → destructive`); each row links to `/leads/{id}`. State panels: unauthorized, error, empty (`"لسه مفيش ليدز…"`),
  empty-filtered. Pagination copies `reviews-pagination.tsx` (RTL chevrons `rtl:-scale-x-100`).
- Detail: all fields, message in `<bdi dir="auto">` with `whitespace-pre-wrap`, page URL as text (not a link), created
  date, a status form (`useActionState`, `<select>` + Save; one `Idempotency-Key` per submit via `newIdempotencyKey`;
  success/failed messages `role="status"`/`role="alert"`; viewers see the status read-only).
- Export button (outline, operators only — hide for viewers like `ordersExportContextFor`) → `GET /leads/export?status=`
  → route handler pages `fetchLeadExportRows` (250/page, cap 5 000) and answers `text/csv; charset=utf-8`, BOM, CRLF,
  `attachment; filename="leads_export_<yyyy-mm-dd>.csv"`, `cache-control: no-store`; failure → 303 to
  `/leads?exportError=<code>`. Columns (`t.leadsExport.columns`): date, name, phone, email, message, status, form, page URL.
- Arabic copy in `ar.ts`: title `"الليدز"`, subtitle `"العملاء اللي سابوا بياناتهم في فورم موقعك"`, statuses
  `جديد / اتواصلنا / مؤهل / اتحول لعميل / مرفوض / سبام`, export `"تصدير CSV"`; English equivalents.

- [ ] **Step 1: Failing tests** — api client maps ok/unauthorized/error and sends `search`/`status`/`after`; CSV: header
      row from `t.leadsExport.columns`, a name `=HYPERLINK("x")` is written as `'=HYPERLINK(""x"")` (guarded and quoted),
      BOM first, CRLF rows; export route: viewer → 303 `exportError=forbidden` (or the orders equivalent), operator →
      200 CSV with two pages concatenated; table renders `<bdi dir="ltr">` around phone and email; badge variants per
      status; status form posts once per submit with an idempotency key and revalidates `/leads` and `/leads/{id}`; nav
      test includes `leads`; middleware maps `/leads` to `viewer`.
- [ ] **Step 2: Run, expect FAIL**

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web exec vitest run src/lib/api/leads.test.ts src/lib/leads src/app/leads src/components/leads src/components/navigation.test.tsx
```

- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS** — the Step 2 command, then:

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web test
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web typecheck
```

Do not run `next build`.

- [ ] **Step 5: Commit** `feat(admin-web): leads inbox with search, status and csv export`.

**Amendments round 1 (binding):**

- (finding 9) Exact client/action contracts in `lib/api/leads.ts`:
  `changeLeadStatus(leadId: string, status: LeadStatus, idempotencyKey: string): Promise<MutationResult<LeadDto>>`
  sending body `{ status }` to `POST /api/v1/leads/{id}/status` via `mutateAdminApi`;
  `changeLeadStatusAction(_prev: FormState, formData: FormData): Promise<FormState>` in `app/leads/actions.ts`.
  Revalidate `/leads` and `/leads/{id}` **after every call that reached the API, whatever the outcome** (track an
  `attempted` flag; revalidate in `finally` when set), then map with `toFormState`. Local validation failures (missing
  id, unknown status) return without calling the API and without revalidating. Tests: ok, 409, 422, 403 and a
  network/unknown outcome each revalidate both paths; a local validation failure revalidates nothing.
- (finding 12) CSV oracle, byte-exact: a lead named `=HYPERLINK("x")` becomes the cell `"'=HYPERLINK(""x"")"`. All eight
  columns go through `csvCell`. Add cases for a message starting with `@`, a tab, a CR, `+1+2` (guarded) and the phone
  `+201012345678` (kept as is). BOM first, CRLF line ends.
