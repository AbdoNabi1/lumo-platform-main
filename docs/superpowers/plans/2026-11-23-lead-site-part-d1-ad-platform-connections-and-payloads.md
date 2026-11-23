# Lead Site Part D1 — Ad Platform Connections and Correct Server Payloads

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** `OPUS: PENDING · Sol: PENDING` (amendments round 1 applied)

**Goal:** a merchant connects Meta, TikTok, Snap and GA4 (and records a Google Ads conversion id for the browser tag)
in Settings → Ad platforms. Each connection turns into a per-shop delivery destination whose server request is
**exactly** the vendor's documented shape, carries identity hashed in that vendor's own format (Plan B), and
authenticates the way that vendor expects. No event source is added here (that is Plan D2); D1 makes the pipe correct
and testable with golden payloads.

**Plan series:** D1 (this) → D2 event sources for lead sites (lead outbox → delivery, first-party `/api/t` intake,
browser SDK + pixels with the same event ids, consent banner, click-id capture, Contact clicks) → E store events
(ViewContent, AddToCart, InitiateCheckout, Purchase at order time, OrderDelivered, cancel). Google Ads **server**
upload (OAuth + developer token, Data Manager API) is a later plan; D1 stores only the browser tag ids.

**Defaults taken (owner's decision form could not be delivered on 2026-11-23; the recommended option of each question
was applied and is listed in the owner status so he can reverse it):**

1. Split: D1 / D2 / E as above.
2. Consent: a per-shop banner (Accept / Reject) in D2; ad events are forwarded only after Accept. D1 keeps the existing
   fail-closed consent gate unchanged.
3. Tokens: encrypted per merchant in Postgres with envelope encryption (KEK ref in an env var, the payments pattern);
   the admin screen never shows a saved token, only "configured · ••••1234".

**Official sources (read 2026-11-23, text saved in `C:/Users/Abdo/AppData/Local/hermes/cache/scratch/lead-site/plan-d-docs/`;
workbook `Morbeh-Tracking-Plan-v5.xlsx` sheet "المصادر الرسمية" holds the earlier ones):**

- [M1] Meta CAPI Using the API — "make a POST request to this API's /events edge from this path:
  https://graph.facebook.com/{API_VERSION}/{PIXEL_ID}/events?access_token={TOKEN}"; body `"data": [ … ]`;
  "Send the test ID as a test_event_code parameter". [M2] Graph API changelog — "The latest Graph API version is: v27.0".
- [T1] TikTok Events API 2.0 web setup — "Endpoint https://business-api.tiktok.com/open_api/v1.3/event/track/", header
  `Access-Token`, body `"event_source": "web"`, `"event_source_id": "{{PIXEL-CODE}}"`, `"data": [ … ]`; "TikTok uses the
  event_source_id, event_id and event to deduplicate". [T2] TikTok supported events — web standard events include
  `Lead` "When a form is submitted", `Contact` "When contact or consultation occurs", `ViewContent`, `AddToCart`,
  `InitiateCheckout`, `AddPaymentInfo`, `Purchase`, `Search`, `CompleteRegistration`, `AddToWishlist`; there is **no**
  PageView; "Optimization is NOT supported" for custom events; "names of the events are case-sensitive".
- [S1] Snap CAPI Using the API — "https://tr.snapchat.com/v3/{PIXEL_ID}/events?access_token={TOKEN}"; "The main request
  body contains a data array"; web example `"action_source": "WEB"`, `"event_time": 1709761985` (seconds).
  [S2] Snap parameters — event names `PURCHASE SAVE START_CHECKOUT ADD_CART VIEW_CONTENT ADD_BILLING SIGN_UP SEARCH
PAGE_VIEW … LOGIN … LIST_VIEW … CUSTOM_EVENT_1 … CUSTOM_EVENT_5`; there is **no** LEAD.
- [G1] GA4 Measurement Protocol sending events — "you use the measurement_id in the request URL and the client_id in the
  JSON body"; `POST /mp/collect?…&api_secret=…`; body `"events": [ … ]` with `params.session_id`; `timestamp_micros`.
  [G2] GA4 user-provided data (workbook [23]) — `user_data.sha256_email_address`, `sha256_phone_number`, `address[]`.

## Design decisions (Opus)

- **DD1 — explicit vendor builders, not the generic mapper.** `applyMapping` cannot write arrays (`writePath`), has no
  event-name map and no micro-second transform, and every real vendor body needs `data[]`/`events[]`. Four typed pure
  builders (`meta.capi.v27`, `tiktok.events.v1_3`, `snap.capi.v3`, `ga4.mp`) replace the mapping step for destinations
  that name a `builderKey`; destinations without one keep the mapper (no behaviour change for them).
- **DD2 — identity per destination.** `receiveAndDeliver` keeps hashing the shared identity (the record and the
  `isForwardable` guard stay as they are) and additionally computes `platformMatchKeys(platform, normalizedRaw, hasher)`
  from the normalized **raw** identity, per routed destination, before hashing. Builders read only those keys.
- **DD3 — one connection row per shop and platform** in `tracking.ad_platform_connections`; secrets sealed with
  `EnvelopeCipher` under KEK alias `ad-platform-credentials` (`AD_PLATFORM_CREDENTIALS_KEK_REF`). The sealed payload
  carries tenant + platform and is re-checked on open (copied envelopes do not open for another shop).
- **DD4 — connections drive the registry.** Saving a connection appends the next version of that shop's destination,
  a stub mapping row for its builder key, and the routing rule set. A destination's credential is the reference
  `conn://<tenantId>/<platform>`, resolved at send time by unsealing the connection.
- **DD5 — routing per vendor and site type.** Each destination's rule admits only the canonical events that vendor
  supports (table below) **and** that the shop's site type allows (`lead_site`: `page_viewed`, `form_submitted`,
  `contact_clicked`; `store`: every row except `form_submitted`).
- **DD6 — auth styles.** `EndpointDescriptor.auth`: `{ kind: "query", param }` (Meta `access_token`, Snap
  `access_token`, GA4 `api_secret`), `{ kind: "header", name }` (TikTok `Access-Token`), `{ kind: "bearer" }` (default,
  unchanged behaviour for every existing destination).

### Canonical event → vendor event name (`packages/tracking/src/delivery/vendor-event-names.ts`)

| canonical          | Meta [M1]                 | TikTok [T2]                       | Snap [S2]                    | GA4                |
| ------------------ | ------------------------- | --------------------------------- | ---------------------------- | ------------------ |
| `page_viewed`      | `PageView`                | — (browser `ttq.page()` only, D2) | `PAGE_VIEW`                  | `page_view`        |
| `form_submitted`   | `Lead`                    | `Lead`                            | `SIGN_UP` (Snap has no LEAD) | `generate_lead`    |
| `contact_clicked`  | `Contact`                 | `Contact`                         | `CUSTOM_EVENT_2`             | `contact`          |
| `product_viewed`   | `ViewContent`             | `ViewContent`                     | `VIEW_CONTENT`               | `view_item`        |
| `view_item_list`   | `ViewCategory` (custom)   | —                                 | `LIST_VIEW`                  | `view_item_list`   |
| `add_to_cart`      | `AddToCart`               | `AddToCart`                       | `ADD_CART`                   | `add_to_cart`      |
| `add_to_wishlist`  | `AddToWishlist`           | `AddToWishlist`                   | `SAVE`                       | `add_to_wishlist`  |
| `checkout_started` | `InitiateCheckout`        | `InitiateCheckout`                | `START_CHECKOUT`             | `begin_checkout`   |
| `add_payment_info` | `AddPaymentInfo`          | `AddPaymentInfo`                  | `ADD_BILLING`                | `add_payment_info` |
| `search`           | `Search`                  | `Search`                          | `SEARCH`                     | `search`           |
| `signup`           | `CompleteRegistration`    | `CompleteRegistration`            | `SIGN_UP`                    | `sign_up`          |
| `login`            | `Login` (custom)          | `Login` (custom)                  | `LOGIN`                      | `login`            |
| `purchase`         | `Purchase`                | `Purchase`                        | `PURCHASE`                   | `purchase`         |
| `order_delivered`  | `OrderDelivered` (custom) | `OrderDelivered` (custom)         | `CUSTOM_EVENT_1`             | `order_delivered`  |
| `order_cancelled`  | `OrderCancelled` (custom) | `OrderCancelled` (custom)         | `CUSTOM_EVENT_5`             | `refund`           |

"—" = not sent to that vendor by the server (no rule admits it).

## Amendments round 1 (binding, preamble)

Precedence: **Amendments round 1 > original task text.** Source: `2026-11-23-lead-site-part-d1-plan-review-1.md`.

- **A0 (Plan review 1, finding 16).** Every command block starts with
  `export pnpm_config_verify_deps_before_run=false` on its own line before the first `node …/pnpm.cjs` call. Dependency
  linking is **not** done by implementers: before dispatching a task that adds a workspace package or dependency, Opus
  runs `node …/pnpm.cjs install --offline --no-frozen-lockfile` once in the foreground (up to 1700 s) and tells the
  implementer the lockfile is already updated; the implementer stages `pnpm-lock.yaml` with its package.json changes.
  The `timeout 600 … install` lines in the tasks are replaced by this rule.
- **A0b (finding 12).** Each manifest dependency or export is added by the first task that imports it, and each task's
  own typecheck must pass at its commit without deep imports.

## Implementers

Task 1 `impl-terra` · Task 2 `impl-sonnet` · Task 3 `impl-terra` · Task 4 `impl-sonnet` · Task 5 `impl-terra` ·
Task 6 `impl-sonnet` (UI). (When terra is rate-limited the task moves to sonnet, per the routing rule.)

## Global Constraints

- Every command printed in full, runnable in bash from `cd 'F:/New folder/morbeh-lead-site'`; pnpm is
  `node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs`. A task adding a workspace package or
  dependency runs `timeout 600 node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs install --offline --no-frozen-lockfile` once.
- Commits: `git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit`, conventional type,
  lowercase subject, trailer `Co-Authored-By: <model>`, foreground with ≥400 s timeout; stage only the task's files;
  never stash/checkout/reset/`--no-verify`; leave lint-staged backup stashes alone. No push.
- Hand-written additive migrations only; never `prisma migrate`/`db push`.
- Tenant always from `context.tenantId`; every Prisma read/update names `tenantId`; writes in
  `runInTenantTransaction`, reads in `runReadScoped`.
- A secret (token, api secret, sealed envelope) never appears in a log line, an error message, a response body, a
  recorded payload or a test snapshot. `TRANSPORT_METADATA_KEYS` already strips `access_token`/`api_secret` from bodies;
  query-string secrets are added by the adapter after the payload is recorded, and the recorded endpoint URL never
  contains them.
- New test files start with `beforeEach(() => { expect.hasAssertions(); })`. Golden tests use the real hasher
  (`createHash("sha256")`) and full expected objects (`toEqual`), never partial matches.
- Tool output may mask phone numbers as `+201****5678`; values in this plan are full numbers.

## Review Focus

1. Each builder's output equals the vendor's documented shape (wrapper array, field names, time unit) for the golden
   fixture, and no raw email/phone/name ever appears in any builder output.
2. A secret never leaks: not in the recorded payload, not in the recorded endpoint URL, not in a response DTO, not in
   an error.
3. Routing never sends `form_submitted` to a store's destinations, never sends commerce events to a lead site's, and
   never sends `page_viewed` to TikTok by server.
4. A copied sealed envelope does not open for another shop or another platform.
5. Destinations without a `builderKey` behave exactly as before (existing delivery tests unchanged and passing).

---

### Task 1: `services/ad-platforms` core (domain, use cases, in-memory, controller)

**Files (create; shape of `services/leads`):** `services/ad-platforms/package.json` (`@platform/ad-platforms`; deps
`@platform/application`, `@platform/contracts`, `@platform/domain`, `@platform/types`, `@platform/utils`; dev deps as
leads), `tsconfig.json`, `vitest.config.ts` (85/85/85/80), `src/index.ts`, `src/domain/connection.ts`,
`src/domain/connection-repository.ts`, `src/application/ports.ts`, `src/application/connections.use-cases.ts`,
`src/infrastructure/in-memory-connection-repository.ts`, `src/infrastructure/in-memory-credential-vault.ts`,
`src/interfaces/presenter.ts` (copy leads), `src/interfaces/connections.controller.ts`, `src/composition.ts`, tests.

**Interfaces (produced):**

```ts
// domain/connection.ts
export const AD_PLATFORMS = ["meta", "tiktok", "snap", "ga4", "google_ads"] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];
export const SERVER_PLATFORMS = [
  "meta",
  "tiktok",
  "snap",
  "ga4",
] as const satisfies readonly AdPlatform[];
export type PublicConfig =
  | { readonly platform: "meta"; readonly pixelId: string }
  | { readonly platform: "tiktok"; readonly pixelCode: string }
  | { readonly platform: "snap"; readonly pixelId: string }
  | { readonly platform: "ga4"; readonly measurementId: string }
  | {
      readonly platform: "google_ads";
      readonly conversionId: string;
      readonly labels: {
        readonly lead?: string;
        readonly contact?: string;
        readonly purchase?: string;
      };
    };
export const PUBLIC_ID_PATTERNS = {
  metaPixelId: /^\d{8,20}$/,
  tiktokPixelCode: /^[A-Z0-9]{10,30}$/,
  snapPixelId: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  ga4MeasurementId: /^G-[A-Z0-9]{4,20}$/,
  googleAdsConversionId: /^AW-\d{6,15}$/,
  googleAdsLabel: /^[A-Za-z0-9_-]{1,64}$/,
  testEventCode: /^[A-Za-z0-9_-]{1,64}$/,
} as const;
export const SECRET_RULE = { min: 10, max: 1024, pattern: /^\S+$/ } as const;
export interface ConnectionProps {
  readonly id: string;
  readonly platform: AdPlatform;
  readonly enabled: boolean;
  readonly publicConfig: PublicConfig | null;
  readonly sealedSecret: string | null;
  readonly secretLast4: string | null;
  readonly testEventCode: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
export class Connection {
  static restore(props: ConnectionProps): Connection;
  readonly props: ConnectionProps;
  /** google_ads: publicConfig present. Server platforms: publicConfig AND sealedSecret present. */
  isComplete(): boolean;
  /** enabled && isComplete() */
  isLive(): boolean;
}
export function validatePublicConfig(
  platform: AdPlatform,
  raw: unknown,
): Result<PublicConfig, ValidationError>;

// domain/connection-repository.ts
export interface ConnectionRepository {
  list(tenantId: string): Promise<readonly Connection[]>;
  get(tenantId: string, platform: AdPlatform): Promise<Connection | null>;
  /** Insert when absent (expectedVersion null) or optimistic update (stored version === expectedVersion); false on conflict. */
  save(tenantId: string, connection: Connection, expectedVersion: number | null): Promise<boolean>;
}

// application/ports.ts
export interface CredentialVaultPort {
  readonly backing: "real" | "stub";
  seal(tenantId: string, platform: AdPlatform, secret: string): Promise<string>;
  open(tenantId: string, platform: AdPlatform, sealed: string): Promise<string>;
}
export interface DeliverySyncPort {
  sync(tenantId: string): Promise<void>;
} // Task 4 provides it; absent → no-op

// application/connections.use-cases.ts
export interface ConnectionView {
  readonly platform: AdPlatform;
  readonly enabled: boolean;
  readonly publicConfig: PublicConfig | null;
  readonly secret: { readonly configured: boolean; readonly last4: string | null }; // google_ads: configured false, last4 null
  readonly testEventCode: string | null;
  readonly complete: boolean;
  readonly live: boolean;
  readonly version: number;
}
export class ListConnections {
  execute(i: { tenantId: string }): Promise<Result<readonly ConnectionView[], DomainError>>;
}
// always 5 views in AD_PLATFORMS order; absent rows → enabled false, publicConfig null, version 0
export interface SaveConnectionInput {
  readonly tenantId: string;
  readonly platform: AdPlatform;
  readonly enabled: boolean;
  readonly publicConfig: unknown; // validated by validatePublicConfig; null allowed only when enabled is false
  readonly secret?: string; // absent or "" → keep the stored secret
  readonly clearSecret?: boolean; // true → remove the stored secret (cannot combine with a non-empty secret)
  readonly testEventCode?: string | null; // "" or null → none; only meta and tiktok accept a value
  readonly expectedVersion: number; // 0 = row not created yet
}
export class SaveConnection {
  execute(i: SaveConnectionInput): Promise<Result<ConnectionView, DomainError>>;
}
/** Internal (delivery only, never routed): the live connection with its opened secret. */
export interface LiveConnection {
  readonly platform: AdPlatform;
  readonly publicConfig: PublicConfig;
  readonly secret: string | null;
  readonly testEventCode: string | null;
}
export class GetLiveConnections {
  execute(i: { tenantId: string }): Promise<Result<readonly LiveConnection[], DomainError>>;
}
export class OpenConnectionSecret {
  execute(i: { tenantId: string; platform: AdPlatform }): Promise<Result<string, DomainError>>;
}
// NotFoundError when the connection is not live or has no secret
export interface PublicAdPlatformsView {
  readonly meta: { readonly pixelId: string } | null;
  readonly tiktok: { readonly pixelCode: string } | null;
  readonly snap: { readonly pixelId: string } | null;
  readonly ga4: { readonly measurementId: string } | null;
  readonly googleAds: {
    readonly conversionId: string;
    readonly labels: { lead?: string; contact?: string; purchase?: string };
  } | null;
}
export class GetPublicAdPlatforms {
  execute(i: { tenantId: string }): Promise<Result<PublicAdPlatformsView, DomainError>>;
}
// a platform is non-null only when its connection is enabled and has publicConfig (secret not required)
```

`SaveConnection` rules, in order: platform must be in `AD_PLATFORMS` (`VALIDATION` field `platform`);
`enabled && publicConfig === null` → `VALIDATION` field `publicConfig`; a non-null `publicConfig` must pass
`validatePublicConfig` (fields `publicConfig.<key>`); `secret` non-empty must satisfy `SECRET_RULE` (field `secret`,
message `must be 10–1024 characters without spaces`) and is refused for `google_ads` (field `secret`);
`secret` non-empty with `clearSecret` → field `clearSecret`; `testEventCode` non-empty must match the pattern and is
refused for snap/ga4/google_ads; a non-empty secret with `vault.backing === "stub"` and `process.env.NODE_ENV ===
"production"` → `UnavailableError("ad platform credential storage is not configured")`; `expectedVersion` mismatch →
`ConcurrencyError`. A new secret is sealed with `vault.seal`, `secretLast4` = its last 4 characters. After a
successful save call `deliverySync?.sync(tenantId)`; a sync failure is logged (no secret) and does **not** fail the
save (the next save or the D2 backfill re-syncs). Controller: `list` 200, `save` 200, `publicView` 200.
`wireAdPlatforms(deps: { clock; idGenerator; vault?: CredentialVaultPort; prisma?: Database; deliverySync?: DeliverySyncPort; logger? })`
→ `{ controller: ConnectionsController; internal: { getLiveConnections; openSecret }; drainOutbox; deliveredEventTypes }`
(no events; absent vault → `InMemoryCredentialVault` with `backing: "stub"`, which base64-encodes and checks tenant+platform on open).

- [ ] **Step 1: Failing tests** (in-memory repo, stub vault, fixed clock `2026-11-23T10:00:00.000Z`):
  - list on an empty shop → 5 views in order, all `enabled false`, `secret.configured false`, `version 0`.
  - save meta `{ pixelId: "123456789012345" }` + secret `"EAAB1234567890abcd"` enabled → view `complete true`,
    `live true`, `secret { configured: true, last4: "abcd" }`, version 1; the stored row's `sealedSecret` is not the
    plain secret.
  - save again with `secret: ""` and `enabled false` → secret kept (`last4 "abcd"`), `live false`, version 2.
  - `clearSecret: true` → `configured false`, `complete false`.
  - validation table: meta pixel `"abc"`; tiktok pixel code lowercase; snap non-UUID; ga4 `"UA-1"`; google_ads
    `conversionId "AW-12"`; google_ads with a secret; snap with `testEventCode`; secret `"short"`; secret with a space;
    `enabled true` + `publicConfig null` → each `VALIDATION` with the named field.
  - stale `expectedVersion` → `CONCURRENCY`.
  - `GetLiveConnections` returns the opened secret for live server platforms only; `OpenConnectionSecret` for a
    disabled platform → `NOT_FOUND`.
  - public view: meta enabled without secret → `meta: { pixelId }` (public ids do not need a secret); google_ads
    enabled → `googleAds { conversionId, labels }`; disabled → null.
  - tenant isolation: shop `t-2` never sees `t-1`'s rows; the stub vault refuses to open `t-1`'s envelope for `t-2`
    and for another platform.
  - `deliverySync` spy called once per successful save with the tenant id; a throwing sync still returns the saved view.
  - Controller: save returns 200 with the view, and the response JSON contains neither the secret nor `sealedSecret`.
- [ ] **Step 2: Run, expect FAIL**

```bash
cd 'F:/New folder/morbeh-lead-site' && timeout 600 node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs install --offline --no-frozen-lockfile
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/ad-platforms test
```

- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS** — the test command, then:

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/ad-platforms typecheck
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/ad-platforms lint
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs arch
```

- [ ] **Step 5: Commit** (stage `services/ad-platforms/**`, `pnpm-lock.yaml`) `feat(ad-platforms): merchant ad platform connections with write-only secrets`.

**Amendments round 1 (binding)**

- (finding 12) Task 1's `wireAdPlatforms` has **no** `prisma` parameter and `package.json` has no `@platform/db`; Task 2
  adds both. Task 1 signature: `wireAdPlatforms(deps: { clock: Clock; idGenerator: IdGenerator; vault?: CredentialVaultPort;
deliverySync?: DeliverySyncPort; logger?: Logger; credentialPolicy?: CredentialPolicy })`.
- (finding 11) Create `src/domain/errors.ts`: `export class CredentialStorageUnavailableError extends DomainError` with
  code `"UNAVAILABLE"`, `retryable: false`, message `"ad platform credential storage is not configured"`. The service
  presenter maps `UNAVAILABLE` → **503** explicitly (do not rely on the default 422). Replace the `NODE_ENV` check with
  `export type CredentialPolicy = "require_real_vault" | "allow_stub"`: a non-empty secret with `vault.backing === "stub"`
  and policy `require_real_vault` → that error. Default policy: `"allow_stub"` in Task 1 (in-memory only); Task 2 makes
  the Prisma branch default to `"require_real_vault"`. Test: policy `require_real_vault` + stub vault + secret → 503 from
  the controller, nothing stored; same without a secret → 200.
- (finding 2) Task 1 also exports the delivery adapter used by Task 4:
  `export interface ConnectionsForDelivery { listLive(tenantId: string): Promise<readonly LiveConnection[]>;
openSecret(tenantId: string, platform: AdPlatform): Promise<string | null>; }` and
  `export function connectionsForDelivery(internal: WiredAdPlatforms["internal"]): ConnectionsForDelivery` —
  `listLive` calls `getLiveConnections.execute`, returns the value on `ok`, throws `Error("ad platform connections unavailable")`
  otherwise; `openSecret` returns the value on `ok`, `null` on `NOT_FOUND`, throws the same generic error on any other
  failure. `internal` is `{ getLiveConnections: GetLiveConnections; openSecret: OpenConnectionSecret }`. Tests for both mappings.

---

### Task 2: persistence and the real credential vault

**Files:**

- Modify: `packages/db/prisma/schema/tracking.prisma` (model below); Create:
  `packages/db/prisma/schema/migrations/20261123000000_ad_platform_connections/migration.sql`; Modify
  `packages/db/prisma/MIGRATIONS.md` (section 5 bullet)
- Create: `services/ad-platforms/src/infrastructure/prisma-connection-repository.ts` (+ `rows.ts`, mapper, tests,
  `prisma-connection-repository.integration.test.ts` gated by `DATABASE_URL_TEST` like leads)
- Create: `services/ad-platforms/src/infrastructure/envelope-credential-vault.ts` (+ test) — copy
  `services/payments/src/infrastructure/envelope-payment-credential-vault.ts` (payload `{ v: 1, t: tenantId, p: platform, s: secret }`,
  generic error `"Ad platform credentials could not be opened"`, never the payload in a message)
- Modify: `services/ad-platforms/src/composition.ts` (Prisma branch), `package.json` (`@platform/db`, `@platform/secrets`, `@prisma/client`)
- Modify: `apps/runtime/src/config.ts` (`AD_PLATFORM_CREDENTIALS_KEK_REF: z.string().min(1).optional()`),
  `.env.example` (documented, commented out), and the runtime composition builds
  `buildAdPlatformCredentialVault(kekRef)` exactly like `buildPaymentCredentialVault` (alias `ad-platform-credentials`)
  and hands it to the admin wiring (field `adPlatformCredentialVault?: CredentialVaultPort` on `AdminHttpDeps`/`AdminWiringDeps` — Task 5 consumes it).

```prisma
model AdPlatformConnection {
  id            String   @id @db.Uuid
  tenantId      String   @map("tenant_id")
  platform      String
  enabled       Boolean  @default(false)
  publicConfig  Json?    @map("public_config")
  sealedSecret  String?  @map("sealed_secret")
  secretLast4   String?  @map("secret_last4")
  testEventCode String?  @map("test_event_code")
  version       Int      @default(1)
  createdAt     DateTime @map("created_at")
  updatedAt     DateTime @map("updated_at")
  @@unique([tenantId, platform])
  @@map("ad_platform_connections")
  @@schema("tracking")
}
```

Migration: `SET row_security = off;` create table (TEXT/BOOLEAN/JSONB/TIMESTAMP(3), PK `id`),
`CHECK ("platform" IN ('meta','tiktok','snap','ga4','google_ads'))`,
`CHECK ("sealed_secret" IS NULL OR "platform" <> 'google_ads')`, unique index `(tenant_id, platform)`, `ENABLE` +
`FORCE ROW LEVEL SECURITY`, `DROP POLICY IF EXISTS tenant_isolation`, `CREATE POLICY tenant_isolation … FOR ALL USING
(tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (…)`, `RESET row_security;`.
`save`: insert via `create` when `expectedVersion === null` (a unique violation → `false`), else `updateMany({ where:
{ tenantId, platform, version: expectedVersion }, data })` → `count === 1`. Mapper: unknown platform or a
`publicConfig` that fails `validatePublicConfig` → `throw new Error("ad_platform_connections.<column> is not valid")`.

- [ ] **Step 1: Failing tests** — `createFakePrisma()` repository tests (round trip of every column; tenant isolation;
      version conflict → false; every call after `set_config('app.tenant_id', …)` and naming `tenantId`); Task 1's
      use-case suite parametrised over in-memory and Prisma repositories (`describe.each`, like leads'
      `testing/lead-use-case-suite.ts`); envelope vault tests with a real `EnvelopeCipher` and a test KEK (copy the payments
      vault test): seal → open round trip; opening with another tenant or platform throws the generic message; the sealed
      string does not contain the plaintext; the error message never contains the plaintext.
- [ ] **Step 2: Run, expect FAIL**

```bash
cd 'F:/New folder/morbeh-lead-site' && timeout 600 node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs install --offline --no-frozen-lockfile
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/ad-platforms test
```

- [ ] **Step 3: Implement**, then:

```bash
cd 'F:/New folder/morbeh-lead-site' && DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy DIRECT_URL=postgresql://dummy:dummy@localhost:5432/dummy node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/db exec prisma validate
cd 'F:/New folder/morbeh-lead-site' && DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy DIRECT_URL=postgresql://dummy:dummy@localhost:5432/dummy node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/db exec prisma generate
```

- [ ] **Step 4: Run, expect PASS** — the Step 2 test command, then:

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/ad-platforms typecheck
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/runtime typecheck
cd 'F:/New folder/morbeh-lead-site' && node scripts/ops/check-env-docs.mjs
cd 'F:/New folder/morbeh-lead-site' && node -e "import('./scripts/dev/check-prisma-tenant-where.mjs').then(async m=>console.log(JSON.stringify(await m.scanPrismaTenantWhere(process.cwd()))))"
```

- [ ] **Step 5: Commit** `feat(ad-platforms): persist connections with sealed credentials`.

**Amendments round 1 (binding)**

- (finding 12) Task 2 adds `@platform/ad-platforms: "workspace:*"` to `apps/runtime/package.json` **and**
  `apps/admin/package.json` (both import its types here) plus `@platform/db`/`@platform/secrets`/`@prisma/client` to the
  service; stage those files and `pnpm-lock.yaml` (Opus links before dispatch, A0). The Prisma branch of
  `wireAdPlatforms` gains `prisma?: Database` and defaults `credentialPolicy` to `"require_real_vault"`.
- (finding 10) `AD_PLATFORM_CREDENTIALS_KEK_REF: z.string().min(32).optional()` with the same comment as
  `PAYMENT_CREDENTIALS_KEK_REF` (`apps/runtime/src/config.ts:232–238`: with the NodeCrypto backend the reference is the
  key material). Config tests: absent → undefined; 31 characters → refused; 32 → accepted. `.env.example` documents it as
  secret key material (commented out).
- (finding 6) Name the runtime field `RuntimeCore.adPlatformCredentialVault?: CredentialVaultPort` (built only when the KEK
  is set) and pass it **explicitly** into `createAdminHttpApi({ … })` in `apps/runtime/src/api.ts` next to the payment vault
  (`api.ts:584–587`), then through `apps/admin/src/http/server.ts` into `wireAdmin`. Add `apps/runtime/src/api.ts` to this
  task's files. Wiring test: a runtime core with a KEK yields an admin whose save seals with the envelope vault (stored
  value parses as a sealed envelope, not `stub:`).
- (finding 19) Repository tests use the leads-style recording Prisma helper for query + `set_config` assertions and a
  queued P2002 error for the insert-conflict path (`createFakePrisma` models neither constraints nor `$executeRaw`);
  uniqueness, RLS and migration shape are asserted by the `DATABASE_URL_TEST`-gated integration suite plus a static test
  that reads `migration.sql` and checks the CHECKs, unique index, ENABLE/FORCE RLS and the policy text.

---

### Task 3: vendor builders, auth styles and per-destination match keys (`packages/tracking`)

**Files:**

- Create: `packages/tracking/src/delivery/vendor-event-names.ts`, `packages/tracking/src/delivery/vendor-builders.ts`,
  `packages/tracking/src/delivery/vendor-builders.test.ts`, `packages/tracking/src/delivery/vendor-event-input.ts` (+ test)
- Modify: `packages/tracking/src/delivery/destination.ts` (`DestinationDefinition.builderKey?`, `vendorTarget?`;
  `EndpointDescriptor.auth?`), `delivery/adapters.ts` (`HttpJsonAdapter` auth styles), `delivery/delivery-pipeline.ts`
  (`renderPayload` uses the builder when `builderKey` is set), `runtime/delivery-runtime.ts` (per-destination match
  keys), `envelope/attribution-context.ts` (`browserIds?`), `envelope/click-ids.ts` (Snap param `ScCid`),
  `src/index.ts` (exports), `delivery/delivery.test.ts` (new cases only)

**Interfaces:**

```ts
// vendor-event-names.ts
export type VendorBuilderKey = "meta.capi.v27" | "tiktok.events.v1_3" | "snap.capi.v3" | "ga4.mp";
export const CANONICAL_EVENTS = [
  "page_viewed",
  "form_submitted",
  "contact_clicked",
  "product_viewed",
  "view_item_list",
  "add_to_cart",
  "add_to_wishlist",
  "checkout_started",
  "add_payment_info",
  "search",
  "signup",
  "login",
  "purchase",
  "order_delivered",
  "order_cancelled",
] as const;
export type CanonicalEvent = (typeof CANONICAL_EVENTS)[number];
/** Exactly the table in the plan; a missing entry = the vendor does not receive that event by server. */
export const VENDOR_EVENT_NAMES: Readonly<
  Record<VendorBuilderKey, Readonly<Partial<Record<CanonicalEvent, string>>>>
>;
export function vendorEventName(builder: VendorBuilderKey, event: string): string | null;
export const SITE_TYPE_EVENTS: {
  readonly lead_site: readonly CanonicalEvent[];
  readonly store: readonly CanonicalEvent[];
};
// lead_site: page_viewed, form_submitted, contact_clicked; store: every canonical event except form_submitted

// vendor-event-input.ts
export interface VendorEventInput {
  readonly eventName: string;
  readonly eventId: string;
  readonly eventTimeMs: number;
  readonly sourceUrl: string | null;
  readonly referrer: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly customerId: string | null;
  readonly keys: PlatformMatchKeys;
  readonly browser: {
    readonly fbp: string | null;
    readonly fbc: string | null;
    readonly ttp: string | null;
    readonly scid: string | null;
    readonly gaClientId: string | null;
    readonly ttclid: string | null;
    readonly scClickId: string | null;
  };
  readonly commerce: {
    readonly valueMajor: number | null;
    readonly currency: string | null;
    readonly orderId: string | null;
    readonly contentType: string | null;
    readonly numItems: number | null;
    readonly contents: readonly {
      readonly id: string;
      readonly quantity: number;
      readonly itemPriceMajor: number | null;
    }[];
  };
  readonly consent: { readonly adUserData: boolean; readonly adPersonalization: boolean };
}
export function vendorEventInputFrom(
  envelope: EnrichedEnvelope,
  keys: PlatformMatchKeys,
): VendorEventInput;
// eventId = envelope.dedupId; eventTimeMs = envelope.eventTimestampMs; sourceUrl = page.eventSourceUrl ?? page.url ?? null;
// ip/userAgent from context.technical; fbp/fbc from attribution.meta; ttp/scid/gaClientId from attribution.browserIds;
// ttclid = clickIds value with param "ttclid"; scClickId = clickIds value with platform "snap";
// valueMajor = valueMinor / 100 (null when absent); contents from payload.contents (itemId, quantity, priceMinor/100);
// consent = grants ad_user_data / ad_personalization === true (absent grants → marketing flag for both)
export function gaClientIdFromCookie(value: string | undefined): string | null;
// "GA1.1.111111111.1764000000" → "111111111.1764000000"; anything else → null

// vendor-builders.ts
export interface VendorTarget {
  readonly id: string;
  readonly testEventCode?: string;
} // pixel id / pixel code / measurement id
export type BuildResult =
  | { readonly ok: true; readonly payload: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly reason: string };
export function buildVendorPayload(
  builder: VendorBuilderKey,
  input: VendorEventInput,
  target: VendorTarget,
): BuildResult;

// destination.ts additions
// DestinationDefinition: readonly builderKey?: VendorBuilderKey; readonly vendorTarget?: VendorTarget;
// EndpointDescriptor:   readonly auth?: { readonly kind: "query"; readonly param: string } | { readonly kind: "header"; readonly name: string } | { readonly kind: "bearer" };
// AttributionContext:   readonly browserIds?: { readonly ttp?: string; readonly scid?: string; readonly gaClientId?: string };
```

**Builder outputs** (omit every key whose value is null/undefined/empty array; `event_time` = `Math.floor(eventTimeMs / 1000)`):

- `meta.capi.v27` → `{ data: [{ event_name, event_time, event_id, action_source: "website", event_source_url,
user_data: { em: [keys.em], ph: [keys.ph], fn: [keys.fn], ln: [keys.ln], ct: [keys.ct], st: [keys.st], zp: [keys.zp],
country: [keys.country], external_id: [keys.externalId], client_ip_address, client_user_agent, fbp, fbc },
custom_data: { value, currency, content_ids, contents: [{ id, quantity, item_price }], content_type, num_items, order_id } }],
test_event_code? }`. `custom_data` omitted when empty.
- `tiktok.events.v1_3` → `{ event_source: "web", event_source_id: target.id, test_event_code?, data: [{ event, event_time,
event_id, user: { email: keys.em, phone: keys.ph, external_id: keys.externalId, ttclid, ttp, ip, user_agent },
properties: { value, currency, content_type, contents: [{ content_id, quantity, price }], order_id },
page: { url: sourceUrl, referrer } }] }`.
- `snap.capi.v3` → `{ data: [{ event_name, event_time, event_id, action_source: "WEB", event_source_url,
user_data: { em: [keys.em], ph: [keys.ph], fn: [keys.fn], ln: [keys.ln], ct: [keys.ct], st: [keys.st], zp: [keys.zp],
country: [keys.country], external_id: [keys.externalId], client_ip_address, client_user_agent, sc_click_id, sc_cookie1: scid },
custom_data: { value, currency, content_ids, num_items, order_id } }] }`.
- `ga4.mp` → requires `gaClientId` (else `{ ok: false, reason: "ga4 client_id unavailable" }`):
  `{ client_id, user_id: customerId, timestamp_micros: eventTimeMs * 1000, consent: { ad_user_data: "GRANTED"|"DENIED",
ad_personalization: "GRANTED"|"DENIED" }, user_data: { sha256_email_address: [keys.em], sha256_phone_number: [keys.ph],
address: [{ sha256_first_name: keys.fn, sha256_last_name: keys.ln, city: keys.ct, region: keys.st, postal_code: keys.zp,
country: keys.country }] }, events: [{ name, params: { engagement_time_msec: 1, page_location: sourceUrl,
transaction_id: orderId, value, currency, items: [{ item_id, quantity, price }] } }] }` (`address` omitted when all its
  fields are absent; `user_data` omitted when empty).
- Every builder: `vendorEventName(builder, input.eventName) === null` → `{ ok: false, reason: "event not supported by <builder>" }`.

**Adapter:** `auth.kind === "query"` → URL gets `param=<encodeURIComponent(secret)>` appended (`?` or `&`), **after**
the request was recorded; the URL stored in the delivery record is the un-authenticated one. `"header"` → header
`name: secret`. absent or `"bearer"` → today's `authorization: Bearer …`. An unresolved credential stays a permanent
failure (today's behaviour).

**Delivery:** `receiveAndDeliver` keeps `normalized = normalizeIdentity(raw, …)` before `hashIdentity`, and for each
routed destination with a `builderKey` computes `platformMatchKeys(MATCH_PLATFORM_OF[builderKey], normalized, hasher)`
(`meta.capi.v27 → "meta"`, `tiktok.events.v1_3 → "tiktok"`, `snap.capi.v3 → "snap"`, `ga4.mp → "ga4"`); identity with
`hashStatus !== "raw"` → keys `{}`. `renderPayload(deps, destination, routingContext, extras?: { envelope, keys })`:
with `builderKey` it returns `buildVendorPayload(builderKey, vendorEventInputFrom(envelope, keys), destination.vendorTarget!)`
(a missing `vendorTarget` → `{ gate: "mapping", detail: "vendor target missing" }`); without it, the existing mapper.

- [ ] **Step 1: Failing tests.** Golden fixture in `vendor-builders.test.ts`:
      identity `normalizeIdentity({ email: "Jane.Doe+x@gmail.com", phone: "+201012345678", firstName: "Ahmed", lastName: "Ali", country: "EG", city: "Cairo" })`,
      `eventName "form_submitted"`, `eventId "lead_0193a1b2-0000-7000-8000-000000000001"`, `eventTimeMs 1764000000123`,
      `sourceUrl "https://clinic.example/offers?utm_source=meta"`, `referrer null`, `ip "203.0.113.7"`,
      `userAgent "Mozilla/5.0 (test)"`, browser `{ fbp: "fb.1.1764000000000.123456789", fbc: "fb.1.1764000000000.AbCdEf",
ttp: "ttp-abc", scid: "scid-xyz", gaClientId: "111111111.1764000000", ttclid: "tt-click-1", scClickId: "sc-click-1" }`,
      no commerce, consent both true; `keys` = `await platformMatchKeys(<platform>, identity, nodeSha256)`.
      Expected (write each as a full literal with `await sha(...)` values):
  - meta: `{ data: [{ event_name: "Lead", event_time: 1764000000, event_id: "lead_…0001", action_source: "website",
event_source_url: "https://clinic.example/offers?utm_source=meta", user_data: { em: [sha("jane.doe+x@gmail.com")],
ph: [sha("201012345678")], fn: [sha("ahmed")], ln: [sha("ali")], ct: [sha("cairo")], country: [sha("eg")],
client_ip_address: "203.0.113.7", client_user_agent: "Mozilla/5.0 (test)", fbp: "fb.1.1764000000000.123456789",
fbc: "fb.1.1764000000000.AbCdEf" } }] }`; with `target.testEventCode "TEST123"` the same plus `test_event_code: "TEST123"`.
  - tiktok (target id `"CABCDE1234567890"`): `{ event_source: "web", event_source_id: "CABCDE1234567890", data: [{ event:
"Lead", event_time: 1764000000, event_id: "lead_…0001", user: { email: sha("jane.doe+x@gmail.com"), phone:
sha("+201012345678"), ttclid: "tt-click-1", ttp: "ttp-abc", ip: "203.0.113.7", user_agent: "Mozilla/5.0 (test)" },
page: { url: "https://clinic.example/offers?utm_source=meta" } }] }`.
  - snap: `{ data: [{ event_name: "SIGN_UP", event_time: 1764000000, event_id: "lead_…0001", action_source: "WEB",
event_source_url: "…", user_data: { em: [sha("jane.doe+x@gmail.com")], ph: [sha("201012345678")], fn: [sha("ahmed")],
ln: [sha("ali")], ct: [sha("cairo")], country: [sha("eg")], client_ip_address: "203.0.113.7", client_user_agent:
"Mozilla/5.0 (test)", sc_click_id: "sc-click-1", sc_cookie1: "scid-xyz" } }] }`.
  - ga4: `{ client_id: "111111111.1764000000", timestamp_micros: 1764000000123000, consent: { ad_user_data: "GRANTED",
ad_personalization: "GRANTED" }, user_data: { sha256_email_address: [sha("janedoe+x@gmail.com")],
sha256_phone_number: [sha("+201012345678")], address: [{ sha256_first_name: sha("ahmed"), sha256_last_name: sha("ali"),
city: "cairo", country: "EG" }] }, events: [{ name: "generate_lead", params: { engagement_time_msec: 1,
page_location: "https://clinic.example/offers?utm_source=meta" } }] }`.
    More cases: `page_viewed` to tiktok → `ok false` "event not supported"; ga4 without `gaClientId` → `ok false`;
    a purchase fixture (`valueMinor 125000`, `currency "EGP"`, `orderId "o-1"`, contents `[{ itemId "p-1", quantity 2,
priceMinor 50000 }, { itemId "p-2", quantity 1, priceMinor 25000 }]`) → meta `custom_data { value: 1250, currency:
"EGP", content_ids: ["p-1","p-2"], contents: [{ id: "p-1", quantity: 2, item_price: 500 }, { id: "p-2", quantity: 1,
item_price: 250 }], content_type: "product", num_items: 3, order_id: "o-1" }` (set `contentType "product"` and
    `numItems 3` in the fixture) and ga4 `params { …, transaction_id: "o-1", value: 1250, currency: "EGP", items: [{ item_id:
"p-1", quantity: 2, price: 500 }, { item_id: "p-2", quantity: 1, price: 250 }] }`; for every builder output,
    `JSON.stringify(payload)` contains none of `"Jane.Doe"`, `"jane.doe"`, `"201012345678"`, `"Ahmed"`, `"ahmed"`
    except inside hashes (assert by checking the raw strings are absent). `VENDOR_EVENT_NAMES` equals the plan table
    (one `it.each` row per cell). `gaClientIdFromCookie` table (`"GA1.1.111111111.1764000000"` → `"111111111.1764000000"`;
    `"GA1.2.1.2"` → `"1.2"`; `"x"`, `undefined` → null).
    `delivery.test.ts` additions: adapter query auth sends `…/events?access_token=s3cret` while the recorded endpoint URL
    has no `access_token`; header auth sends `Access-Token: s3cret`; no `auth` → `authorization: Bearer s3cret` (existing
    test unchanged); `renderPayload` with `builderKey` returns the builder output and without it the mapper output
    (existing mapper tests unchanged).
    `delivery-runtime` test: two routed builder destinations (meta, tiktok) receive phone hashes `sha("201012345678")`
    and `sha("+201012345678")` respectively from one raw identity, while the recorded identity remains the shared hashed one.
    `click-ids` test: a page URL with `ScCid=abc` yields a snap click id; the old `scclid` param no longer matches.
- [ ] **Step 2: Run, expect FAIL**

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/tracking exec vitest run src/delivery src/runtime src/envelope src/collector
```

- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS**

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/tracking test
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/tracking typecheck
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/runtime typecheck
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs arch
```

- [ ] **Step 5: Commit** `feat(tracking): vendor payload builders and per-destination match keys`.

**Amendments round 1 (binding)**

- (finding 3) `renderPayload` translates every builder refusal into the existing outcome:
  `{ ok: false, failure: { gate: "mapping", detail: <reason> } }` (never the builder's raw shape); missing `extras` or
  missing `vendorTarget` → same with detail `"vendor builder input missing"` / `"vendor target missing"`. Tests through
  `receiveAndDeliver`: an unsupported event (tiktok `page_viewed`) and GA4 without client id are recorded `blocked` with
  that detail and the fake HTTP transport is never called.
- (finding 4) Click ids: `ttclid = clickIds.find(c => c.name === "ttclid")?.value`; Snap keeps the canonical key
  `"scclid"` — `scClickId = clickIds.find(c => c.name === "scclid")?.value` — and only that definition's URL `param` changes to
  `"ScCid"` in `envelope/click-ids.ts` (platform stays `"snapchat"`). `vendor-event-input.test.ts` builds `clickIds` from
  real `extractClickIds` output for a URL with `ttclid=tt-click-1&ScCid=sc-click-1`.
- (finding 9) Secrets in failure paths: `HttpJsonAdapter` never mutates `request.endpoint`; it builds the authenticated
  URL/headers locally and passes every string it returns (`error`, and `vendorResponse` via JSON round-trip) through
  `redactSecrets(text, [secret, encodeURIComponent(secret)])`, replacing each occurrence with `"[redacted]"`; a thrown
  transport error is reduced to `redactSecrets(error.message)`. Tests: a transport that throws an error containing
  `?access_token=secret-proof-1234` and a vendor that echoes the token in its JSON body → the whole recorded EventRecord
  (history + attempts), the dead-letter payload and captured logger output contain no `secret-proof-1234` and no
  `secret-proof-1234` URL-encoded; the registry destination URL is unchanged; `records.append` is captured before the
  fake HTTP send (record-before-send). Remove the "recorded endpoint URL" assertion (no such field).
- (finding 13) Snap: `external_id: keys.externalId` (scalar string) and `num_items: String(numItems)`; em/ph/fn/ln/ct/st/
  zp/country stay arrays. Add a Snap golden with `externalId` and a Snap purchase golden with `num_items: "3"`.
- (finding 14) Required-field refusals (reason text never contains raw values): every builder → `sourceUrl` must be an
  `http(s)` URL else `"event source url missing"`; tiktok also needs `page.url` (same rule); snap → at least one of
  `keys.em`, `keys.ph`, or both `ip` and `userAgent`, else `"snap matching data missing"`; snap `purchase` → `valueMajor`
  and `currency` present else `"snap purchase value missing"`. Each through `receiveAndDeliver` as recorded blocked, no HTTP call.
- (finding 15) `VendorEventInput.commerce` gains `contentIds: readonly string[]` = `payload.contentIds` when non-empty,
  else the contents' `itemId`s; `contents[].quantity` = `item.quantity ?? 1`; `itemPriceMajor` = `priceMinor / 100` or
  `null` when absent (omitted from the vendor item); `numItems` = `payload.numItems ?? deriveNumItems(...)` semantics.
  Meta `content_ids` and Snap `content_ids` come from `contentIds`. Tests: ids-only payload → `content_ids` present, no
  `contents`; a line item without quantity → quantity 1.
- (finding 12) Export `STANDARD_RETRY` from `delivery/platform-profiles.ts` and the barrel (add the file to this task).
- (finding 18, optional, accepted) `VendorEventInput.browser.gaSessionId: string | null` (from
  `attribution.browserIds.gaSessionId?`); GA4 puts it in `params.session_id` when present. Golden with and without it.
  D2 supplies the real GA session id from the `_ga_<container>` cookie (never Morbeh's `morbeh_sid`).

---

### Task 4: runtime — connections become destinations; `conn://` credentials

**Files:**

- Create: `apps/runtime/src/tracking/ad-platform-destinations.ts` (+ test), `apps/runtime/src/tracking/connection-credential-resolver.ts` (+ test)
- Modify: `apps/runtime/src/tracking/wire-tracking-runtime.ts` (credential resolver chain), `apps/runtime/src/composition.ts`,
  `apps/runtime/package.json` (`@platform/ad-platforms`)
- Wiring (no cycle): the runtime composition builds its **own** instance
  `const adPlatformsForDelivery = wireAdPlatforms({ prisma, vault: adPlatformCredentialVault, clock, idGenerator }).internal`
  (stateless over the same tables; no `deliverySync`), builds `AdPlatformDeliverySync` and `ConnectionCredentialResolver`
  from it, and passes the sync to the admin wiring through a new `AdminHttpDeps`/`AdminWiringDeps` field
  `adPlatformDeliverySync?: DeliverySyncPort` (next to `adPlatformCredentialVault`, Task 2).

**Interfaces:**

```ts
// ad-platform-destinations.ts
export const BUILDER_OF: Readonly<Record<"meta" | "tiktok" | "snap" | "ga4", VendorBuilderKey>>;
export function destinationFor(conn: LiveConnection, tenantId: string): DestinationDefinition;
// meta:   key "meta.capi",     url `https://graph.facebook.com/v27.0/${pixelId}/events`,                auth { kind: "query", param: "access_token" }
// tiktok: key "tiktok.events", url "https://business-api.tiktok.com/open_api/v1.3/event/track/",       auth { kind: "header", name: "Access-Token" }
// snap:   key "snap.capi",     url `https://tr.snapchat.com/v3/${pixelId}/events`,                    auth { kind: "query", param: "access_token" }
// ga4:    key "ga4.mp",        url `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}`, auth { kind: "query", param: "api_secret" }
// all: platform = conn.platform, transport "http_json", channel "server", consentPurpose "marketing", method "POST",
//      timeoutMs 5000, retry STANDARD_RETRY, enabled true, builderKey BUILDER_OF[platform],
//      mappingProfileKey = builderKey, credentialRef `conn://${tenantId}/${platform}`,
//      vendorTarget { id: pixelId | pixelCode | measurementId, testEventCode?: conn.testEventCode ?? undefined }
export function routingRuleSetFor(
  destinations: readonly DestinationDefinition[],
  siteType: "store" | "lead_site",
  version: number,
): RuleSet<DestinationKey>;
// one rule per destination: when = Expr.in(<event.name path expression>, allowed), allowed = SITE_TYPE_EVENTS[siteType]
//   ∩ events with a VENDOR_EVENT_NAMES entry for the destination's builder; mode "all_matches"; onError "fail_closed";
//   key DEFAULT_RULE_SET_KEY. Use the path-expression constructor exported by @platform/expression (as Expr.where does).
export class AdPlatformDeliverySync implements DeliverySyncPort {
  constructor(deps: {
    store: PrismaTrackingRegistryStore;
    connections: { getLiveConnections(tenantId: string): Promise<readonly LiveConnection[]> };
    siteTypeOf(tenantId: string): Promise<"store" | "lead_site">;
    clock: Clock;
  });
  sync(tenantId: string): Promise<void>;
}
```

`sync(tenantId)`: load live connections (server platforms only); load the tenant's current registry rows; for each
server platform key compute the desired destination (`destinationFor`) or "absent"; append the next version for every
key whose value differs from the latest active row (status `active`), retire (append next version with status
`retired`) a key that has an active row but no live connection, append a stub mapping row
`{ key: builderKey, destination: <key>, fields: [] }` (shape per `MappingProfile` in `delivery/mapping.ts`) the first
time a builder key appears, and append the next rule-set version only when its rules changed. All appends for one
sync run in one tenant transaction. Running `sync` twice with no change appends nothing. Site type comes from the
tenancy public store read (Plan A).
`ConnectionCredentialResolver.resolve(ref)`: refs matching `^conn://([^/]+)/(meta|tiktok|snap|ga4)$` → `openSecret`
for that tenant and platform (null on `NOT_FOUND`); any other ref → the existing resolver.

- [ ] **Step 1: Failing tests** — `destinationFor` exact objects for the 4 platforms (no secret anywhere in them);
      `routingRuleSetFor` for `lead_site` with meta+tiktok → meta admits exactly `page_viewed`, `form_submitted`,
      `contact_clicked`; tiktok admits `form_submitted`, `contact_clicked` (no page view); for `store`, no rule admits
      `form_submitted`; evaluating each rule against `{ event: { name: "purchase" } }` matches on store, not on lead site;
      `AdPlatformDeliverySync` with an in-memory registry store fake: first sync appends 1 destination + 1 mapping + 1 rule
      set for one live meta connection; second sync appends nothing; disabling meta appends a `retired` destination version
      and a new rule set without meta; changing the pixel id appends a new destination version only; the resolver opens
      `conn://t-1/meta`, returns null for a disabled one, and delegates `vault://…` refs.
- [ ] **Step 2: Run, expect FAIL**

```bash
cd 'F:/New folder/morbeh-lead-site' && timeout 600 node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs install --offline --no-frozen-lockfile
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/runtime exec vitest run src/tracking/ad-platform-destinations.test.ts src/tracking/connection-credential-resolver.test.ts
```

- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS** — the Step 2 vitest command, then:

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/runtime exec vitest run src/tracking
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/runtime typecheck
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs arch
```

(`src/kafka-topics/topic-inventory.test.ts` fails before this work and is unrelated.)

- [ ] **Step 5: Commit** `feat(runtime): ad platform connections drive per-shop delivery destinations`.

**Amendments round 1 (binding)**

- (finding 1) The stub mapping row value is a complete `MappingProfile`: `{ key: builderKey, version: <row version>,
destination: <destination key>, fields: [] }` (check `delivery/mapping.ts:79–85` for any other required field and
  include it). Tests load the sync-produced rows through the real `TrackingRegistrySnapshot` and run one event through
  the recording runtime with a fake HTTP transport.
- (finding 2) The sync and the resolver consume `ConnectionsForDelivery` (Task 1 amendment):
  `connectionsForDelivery(wireAdPlatforms({ prisma, vault, clock, idGenerator }).internal)`.
- (finding 5) Lifecycle comparison: group **all** rows by kind+key; the current state is the highest version of any
  status. Append only when the desired (value, status) differs from that row; the next version is `max(all versions) + 1`.
  Tests: disable twice → second sync appends nothing; re-enable unchanged → active v3 resolves again through the real
  snapshot; no connection at all (or Google-Ads-only) → first sync writes an **empty active rule set** that loads via
  `loadTrackingRegistry` (finding 19).
- (finding 8) Add to `apps/runtime/src/tracking/tracking-registry.ts` (and its tests):
  `withTenantRegistryTransaction<T>(tenantId: string, fn: (writer: TenantRegistryWriter) => Promise<T>): Promise<T>` on
  `PrismaTrackingRegistryStore`, implemented as `runInTenantTransaction(this.prisma, tenantId, async (tx) => …)`; the
  first statement inside is the tagged-template raw query `SELECT pg_advisory_xact_lock(hashtext(<'tracking-registry:' + tenantId>))`
  (key as a bound parameter), then `return fn(writerOver(tx, tenantId))`, where
  `TenantRegistryWriter = { loadAll(): Promise<readonly TrackingRegistryRow[]>; append(row): Promise<void> }` runs
  every query on `tx` and names `tenantId`. `AdPlatformDeliverySync.sync` reads the live connections **inside** that
  transaction (after the lock) and does all appends there. No process-local lock, no casting a root client. Tests: a
  failing middle append rolls back the earlier ones; two concurrent syncs (meta saved, tiktok saved) end with a
  loadable registry whose versions are contiguous and which contains both destinations (in-memory store test simulates
  the lock with a promise chain; the gated integration test uses real Postgres).
- (finding 12) `retry: STANDARD_RETRY` imported from `@platform/tracking` (exported by Task 3).
- (finding 6) `RuntimeCore.adPlatformDeliverySync?: DeliverySyncPort` populated in `composition.ts` and passed explicitly in
  `apps/runtime/src/api.ts` to `createAdminHttpApi`; add `api.ts` to this task's files; a wiring test proves a save
  through the admin reaches the real sync.
- Use exactly `Expr.in(Expr.ref("event.name"), allowed)` for each rule (Sol verified the API).

---

### Task 5: admin API for connections

**Files:**

- Modify: `apps/admin/package.json` (`@platform/ad-platforms`), `apps/admin/src/composition.ts` (`wireAdPlatforms({ …, vault: deps.adPlatformCredentialVault, deliverySync: deps.adPlatformDeliverySync })`;
  `WiredAdmin.adPlatforms`; `publicReads.adPlatforms`; the admin never exposes `internal`), `apps/admin/src/http/admin-routes.ts`,
  `apps/admin/src/http/server.ts` (pass the two deps fields from Tasks 2 and 4 through to `wireAdmin`)
- Create: `apps/admin/src/interfaces/ad-platforms.admin-controller.ts`, `apps/admin/src/http/ad-platforms-routes.ts`,
  `apps/admin/src/http/public-ad-platforms-routes.ts` (+ tests)

**Routes:**

- `GET /ad-platforms` — permission `settings:read` — `{ items: ConnectionView[] }`.
- `PUT /ad-platforms/:platform` — permission `settings:update`, `idempotent: true`, params `platform: z.enum(AD_PLATFORMS)`,
  body `.strict()`: `{ enabled: z.boolean(), publicConfig: z.record(z.string(), z.unknown()).nullable(),
secret: z.string().max(1024).optional(), clearSecret: z.boolean().optional(),
testEventCode: z.string().max(64).nullable().optional(), expectedVersion: z.number().int().min(0) }`;
  the handler adds `platform` into `publicConfig` before calling the use case → 200 `ConnectionView`.
- `GET /public/ad-platforms` — `public: true`, permission `settings:read` — `PublicAdPlatformsView` (consumed in D2).

- [ ] **Step 1: Failing tests** (real server harness used by `server.multi-tenant.test.ts`): admin token lists 5
      items; PUT meta with valid ids + secret → 200 and the response body (stringified) does not contain the secret; GET
      afterwards shows `secret.configured true` and `last4`; PUT with `tenantId` in the body → 422; PUT `platform "x"` → 422;
      a viewer gets 403 on PUT and 200 on GET (role table already gives viewers `settings:read`? — assert whatever
      `packages/auth/src/role-table-access-control.ts` grants and name it in the report); shop A never sees shop B's
      connections; the public route returns only public ids (no `secret`, no `testEventCode`); the delivery-sync spy is
      called with the shop id after a successful PUT.
- [ ] **Step 2: Run, expect FAIL**

```bash
cd 'F:/New folder/morbeh-lead-site' && timeout 600 node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs install --offline --no-frozen-lockfile
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin exec vitest run src/http/ad-platforms-routes.test.ts src/http/public-ad-platforms-routes.test.ts
```

- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS**

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin test
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin typecheck
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/runtime typecheck
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs arch
```

- [ ] **Step 5: Commit** `feat(admin): ad platform connections api`.

**Amendments round 1 (binding)**

- (finding 7) Role expectations: **admin** GET and PUT allowed; **viewer and operator** GET and PUT → 403 (the role
  table grants neither `settings:read` nor `settings:update` to them; no permission change). The route tests inject the
  real `RoleTableAccessControl` and real staff tokens (the default harness uses `AllowAllAccessControl`, which would pass
  falsely). The "assert whatever … grants" sentence is deleted.
- (finding 11) A PUT with a token while no real vault is configured (production policy) → 503 envelope code `UNAVAILABLE`.

---

### Task 6: admin-web Settings → Ad platforms (UI)

**Files:** Create `apps/admin-web/src/app/settings/ad-platforms/page.tsx`, `actions.ts` (+ test),
`apps/admin-web/src/components/settings/ad-platforms-form.tsx` (+ test), `apps/admin-web/src/lib/api/ad-platforms.ts`
(+ test). Modify `apps/admin-web/src/app/settings/page.tsx` (`SECTIONS` row), `messages/en.ts` + `ar.ts`
(`settingsPage.adPlatformsTitle/Body`, new `adPlatformsSettings` block). No middleware change (`/settings` is admin).

**Behaviour:** one `Card` per platform in `AD_PLATFORMS` order, each its own `<form>` (one save = one platform, one
`Idempotency-Key`, `expectedVersion` from the view): an enable `Switch`; public id inputs (`dir="ltr"`, `inputMode`
as fits, `autoComplete="off"`); for server platforms a token field `type="password"` with placeholder
`"••••" + last4` when configured, help text "Leave empty to keep the saved token", and a "Remove token" checkbox
(`clearSecret`); test event code only for Meta and TikTok; Google Ads card: conversion id + three labels (lead,
contact, purchase) and a note that server upload comes later. Status badge per card: "Live" (success), "Incomplete"
(warning), "Off" (neutral) from `live`/`complete`/`enabled`. A site-type note: lead sites send Page view, Lead and
Contact; stores send commerce events (from `fetchStoreSettings().siteType`). Saved → success message `role="status"`;
errors → field messages from the 422 envelope + `role="alert"`; 409 → "Someone else changed this; reload". Never put a
token in a URL, a log, a revalidated path or the DOM after save (the token input is cleared on success).
Copy (ar): title `"منصات الإعلانات"`, body `"اربط Meta وTikTok وSnap وGoogle عشان أحداث موقعك توصل لكل منصة"`,
badges `"شغّال" / "ناقص بيانات" / "مقفول"`, keep-token help `"سيبه فاضي عشان التوكن المحفوظ يفضل زي ما هو"`,
remove `"امسح التوكن"`, google note `"الإرسال من السيرفر لـ Google Ads جاي في خطوة بعدين؛ دلوقتي بيشتغل من المتصفح بس"`; English equivalents.

- [ ] **Step 1: Failing tests** — api client: GET maps ok/unauthorized/error, PUT sends exactly the body fields and
      never sends `secret` when the input is empty; action: blank token → body without `secret`; "Remove token" →
      `clearSecret: true`; 422 field errors mapped; the action never returns the token in its state; form: renders 5
      cards, badges per state, test-event-code field only on Meta/TikTok, the password input is empty after a successful
      save; settings index lists the new row.
- [ ] **Step 2: Run, expect FAIL**

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web exec vitest run src/lib/api/ad-platforms.test.ts src/app/settings src/components/settings
```

- [ ] **Step 3: Implement** (design system rules: semantic tokens, `@platform/ui`, logical properties, every input labelled, `<bdi dir="ltr">` around ids shown as text).
- [ ] **Step 4: Run, expect PASS**

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web test
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web typecheck
```

Do not run `next build`.

- [ ] **Step 5: Commit** `feat(admin-web): ad platforms settings page`.

**Amendments round 1 (binding)**

- (finding 17) Types in `lib/api/ad-platforms.ts` are browser-safe copies (no import from `@platform/ad-platforms`):
  `AdPlatformKey`, `ConnectionViewDto`, `AD_PLATFORM_ORDER`. The action is
  `saveAdPlatformAction(_prev: AdPlatformFormState, formData: FormData): Promise<AdPlatformFormState>` with
  `AdPlatformFormState = { status: "idle" } | { status: "success"; view: ConnectionViewDto } | { status: "error"; message: string; fieldErrors?: Record<string, string>; conflict?: boolean }`.
  After every call that reached the API (ok or not) it calls `revalidatePath("/settings/ad-platforms")`; after an ok save
  that changed public ids or `enabled` it also calls the existing `revalidateStorefront()` helper. Each card keeps the
  latest `ConnectionViewDto` in client state, seeded from props and replaced by `state.view` on success, and posts
  `expectedVersion` from that state, so a second save does not conflict. Test two consecutive saves (second sends the
  incremented version) and revalidation on a non-ok result.
- (finding 17) "Remove token" is a button that opens a real `@platform/ui` `Dialog` (title, described warning, initial
  focus on Cancel, Escape closes, focus returns to the still-mounted trigger); confirming submits `clearSecret: true`.
  Vendor names render inside `<bdi dir="auto">`. Non-disclosure tests check `document.body` (portalled dialog) for the
  token text after save.
