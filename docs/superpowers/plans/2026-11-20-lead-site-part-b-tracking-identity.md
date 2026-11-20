# Lead Site Part B — Tracking Identity Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** `OPUS: PENDING · Sol: PENDING`

**Goal:** the pure building blocks every later tracking plan uses: correct phone/name normalization for Egyptian and
Gulf input, identity hashed **in the exact form each ad platform expects**, Morbeh event ids, and the
"one lead event per session" rule.

**Architecture:** all code is pure and lives in `packages/tracking` (no I/O; hashing and storage are injected ports, the
same `HashPort` the package already uses). Nothing here sends to a platform yet — Plan D wires these into delivery. The
existing shared `hashIdentity` stays untouched in this plan.

**Tech stack:** TypeScript, vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-20-lead-site-and-tracking-design.md` (decisions 3, 4, 6 and the identity table).
Official sources: workbook `Morbeh-Tracking-Plan-v4.xlsx`, sheet "المصادر الرسمية" ([1] Meta customer info, [8] Meta
advanced matching, [9] TikTok web setup, [15] Snap parameters, [17] Snap dedup, [20] Google Ads EC web, [22] Data
Manager formatting, [23] GA4 MP user data, [32] TikTok advanced matching).

**Base:** branch `morbeh/lead-site`, after Plan A or in parallel (no common files).

## Implementers

Task 1 `impl-terra` · Task 2 `impl-sonnet` · Task 3 `impl-terra`.

## Global Constraints

- Hash = SHA-256 over UTF-8, **lowercase hex**, through the injected `HashPort` (`packages/tracking/src/ids/dedup-id.ts`).
- Tests use a real hasher: `const nodeSha256: HashPort = { sha256Hex: async (s) => createHash("sha256").update(s, "utf8").digest("hex") };`
  (`import { createHash } from "node:crypto"`), and new test files start with `expect.hasAssertions()`.
- Never hash: IP, user agent, `fbp`, `fbc`, `ttclid`, `ttp`, `sc_click_id`, `sc_cookie1`, gclid/gbraid/wbraid.
- Tool output may mask phone numbers as `+201****5678`; the plan's literal values are the full numbers, e.g. `+201012345678`.
- pnpm: `node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs`. Commit rules as in Plan A.
- `packages/*` must not import from `apps/*` (`pnpm arch`).

## Review Focus

1. A phone typed with Arabic digits `٠١٠١٢٣٤٥٦٧٨` must hash identically to `01012345678`.
2. A phone already carrying the country code without `+` (`201012345678`) or with `00` (`00201012345678`) must not get
   the code prepended twice (today it becomes `+20201012345678`).
3. The gmail rule must apply only to Google Ads (dots and `+suffix`) and GA4 (dots only), never to Meta/TikTok/Snap, and
   never to non-gmail domains.
4. Google Ads must omit the whole address (names included) unless first name, last name, country and postal code all
   exist ([20]: "If any of these four fields are unavailable … omit").
5. A provided event id that is a template placeholder (`undefined`, `null`, `{{order.id}}`, `%OrderId%`) must be refused,
   not forwarded ([17]).

---

### Task 1: normalization fixes — digits, phone forms, Arabic names

**Files:**
- Modify: `packages/tracking/src/pipeline/normalization.ts`
- Test: `packages/tracking/src/pipeline/pipeline.test.ts` (extend the existing `normalizePhone (E.164)` and
  `normalizeName` describes; the existing assertions there must still pass unchanged)

**Interfaces:**
- Produces: `export function toLatinDigits(value: string): string` — maps U+0660–U+0669 and U+06F0–U+06F9 to `0-9`,
  everything else unchanged.
- Produces: `export const NATIONAL_NUMBER_LENGTHS: Readonly<Record<string, readonly number[]>> = { "20": [9, 10], "966": [9], "971": [8, 9] };`
  (EG mobile 10 / landline 9, SA 9, UAE mobile 9 / landline 8 national digits.)
- `normalizePhone(phone, defaultCountryCode?)` keeps its signature; `normalizeName(name)` keeps its signature.

- [ ] **Step 1: Failing tests**

```ts
describe("normalizePhone — Egyptian and Gulf input", () => {
  it.each([
    ["01012345678", "20", "+201012345678"],
    ["٠١٠١٢٣٤٥٦٧٨", "20", "+201012345678"],
    ["۰۱۰۱۲۳۴۵۶۷۸", "20", "+201012345678"],
    ["1012345678", "20", "+201012345678"],
    ["201012345678", "20", "+201012345678"],
    ["00201012345678", "20", "+201012345678"],
    ["+20 101 234 5678", "20", "+201012345678"],
    ["0501234567", "966", "+966501234567"],
    ["966501234567", "966", "+966501234567"],
    ["0501234567", "971", "+971501234567"],
    ["0223456789", "20", "+20223456789"],
  ])("%s with cc %s → %s", (input, cc, expected) => {
    expect(normalizePhone(input, cc)).toBe(expected);
  });
  it("accepts an 00-prefixed international number without a default country", () => {
    expect(normalizePhone("00201012345678")).toBe("+201012345678");
  });
  it("drops a national number of the wrong length for a known country", () => {
    expect(normalizePhone("010123456", "20")).toBeUndefined();    // 8 national digits
    expect(normalizePhone("010123456789", "20")).toBeUndefined(); // 11 national digits
  });
});
describe("normalizeName — Arabic", () => {
  it("removes tatweel and diacritics", () => {
    expect(normalizeName("أحمـــد")).toBe("أحمد");
    expect(normalizeName("مُحَمَّد")).toBe("محمد");
  });
});
it("toLatinDigits converts Arabic-Indic and Persian digits only", () => {
  expect(toLatinDigits("٠١٢٣٤٥٦٧٨٩ ۰۱۲ abc")).toBe("0123456789 012 abc");
});
```

- [ ] **Step 2:** `node <pnpm.cjs> --filter @platform/tracking exec vitest run src/pipeline/pipeline.test.ts` → FAIL.
- [ ] **Step 3: Implement.** `normalizePhone` order: `toLatinDigits` first; then
  1. leading `+` → international (existing 8–15 digit rule);
  2. digits start with `00` → drop `00`, treat as international (same 8–15 rule);
  3. with `cc` (digits of `defaultCountryCode`): if `NATIONAL_NUMBER_LENGTHS[cc]` is known and
     `digits.startsWith(cc)` and `digits.length - cc.length` is one of those lengths → `+${digits}`;
  4. otherwise strip leading `0`s; if the lengths are known the national part must have one of them, else `undefined`;
     unknown `cc` keeps today's `9..16` total-length bound; result `+${cc}${national}`.
  `normalizeName`: remove U+0640 (tatweel) in addition to today's `[^\p{L}\p{N}]` removal.
- [ ] **Step 4:** same command → PASS (old and new tests); `node <pnpm.cjs> --filter @platform/tracking typecheck` → 0 errors.
- [ ] **Step 5: Commit** `fix(tracking): normalize Egyptian and Gulf phone input and Arabic names`.

---

### Task 2: per-platform match keys

**Files:**
- Create: `packages/tracking/src/pipeline/platform-identity.ts`
- Create: `packages/tracking/src/pipeline/platform-identity.test.ts`
- Modify: `packages/tracking/src/index.ts` (new commented export block "Per-platform match keys (lead-site plan B)")

**Interfaces:**
- Consumes: Task 1 normalization (input identity is the output of `normalizeIdentity`, `hashStatus: "raw"`); `HashPort`;
  `DoubleHashError` from `./hashing`.
- Produces:

```ts
export type MatchPlatform = "meta" | "snap" | "tiktok" | "google_ads" | "ga4";
export interface PlatformMatchKeys {        // values are final: a hash or a plain value, per the table below
  readonly em?: string; readonly ph?: string; readonly fn?: string; readonly ln?: string;
  readonly ct?: string; readonly st?: string; readonly zp?: string; readonly country?: string;
  readonly externalId?: string;
}
export function splitFullName(full: string | undefined): { readonly firstName?: string; readonly lastName?: string };
export function emailForPlatform(email: string, platform: MatchPlatform): string;   // input already normalized
export function phoneForPlatform(e164: string, platform: MatchPlatform): string;    // input "+<digits>"
export async function platformMatchKeys(platform: MatchPlatform, identity: IdentityContext, hasher: HashPort): Promise<PlatformMatchKeys>;
```

Rules (from the spec table): `emailForPlatform` — `google_ads`: for `gmail.com`/`googlemail.com` remove every `.` and
the first `+` with everything after it from the local part; `ga4`: for those domains remove dots only; others: unchanged.
`phoneForPlatform` — `meta`/`snap`: drop the `+`; others: unchanged. Hashed vs plain per platform:

| key | meta, snap | tiktok | google_ads | ga4 |
|---|---|---|---|---|
| em, ph | hash | hash | hash | hash |
| fn, ln | hash | hash | hash, only with full address | hash (digits removed first) |
| ct, st | hash | plain | plain, only with full address | plain |
| zp | hash | hash | plain, only with full address | plain |
| country | hash (`eg`) | plain (`eg`) | plain `EG`, only with full address | plain `EG` |
| externalId | hash (trimmed) | hash (trimmed) | omitted | omitted |

"Full address" = `firstName`, `lastName`, `country` and `postalCode` all present; otherwise omit fn, ln, ct, st, zp,
country for `google_ads`. Absent inputs produce absent keys (never `""`). Identity with `hashStatus !== "raw"` →
throw `DoubleHashError`.

- [ ] **Step 1: Failing tests** (fixture `base = normalizeIdentity({ email: " Jane.Doe+Shopping@googlemail.com ",
  phone: "01012345678", firstName: "Ahmed", lastName: "Ali", city: "Cairo", country: "EG", postalCode: "11511",
  externalId: " cust-123 " }, { defaultCountryCode: "20" })`; `sha = (s) => nodeSha256.sha256Hex(s)`)

```ts
it("pins two literal digests so the hasher itself is checked", async () => {
  expect(await sha("201012345678")).toBe("b12a7c358b87131b5cef5a3e69a5d474532a78e4a3183971b2c70f67c8bb3c8f");
  expect(await sha("+201012345678")).toBe("0895f44c7a43ae484d10b8509021516091079927afc18baa37fad1a70f35c01d");
});
it("meta: everything hashed, phone without +", async () => {
  expect(await platformMatchKeys("meta", base, nodeSha256)).toEqual({
    em: await sha("jane.doe+shopping@googlemail.com"), ph: await sha("201012345678"),
    fn: await sha("ahmed"), ln: await sha("ali"), ct: await sha("cairo"), zp: await sha("11511"),
    country: await sha("eg"), externalId: await sha("cust-123"),
  });
});
it("snap equals meta", async () => {
  expect(await platformMatchKeys("snap", base, nodeSha256)).toEqual(await platformMatchKeys("meta", base, nodeSha256));
});
it("tiktok: phone with +, city and country plain", async () => {
  expect(await platformMatchKeys("tiktok", base, nodeSha256)).toEqual({
    em: await sha("jane.doe+shopping@googlemail.com"), ph: await sha("+201012345678"),
    fn: await sha("ahmed"), ln: await sha("ali"), ct: "cairo", zp: await sha("11511"),
    country: "eg", externalId: await sha("cust-123"),
  });
});
it("google_ads: gmail dots and +suffix removed, address plain parts, no external id", async () => {
  expect(await platformMatchKeys("google_ads", base, nodeSha256)).toEqual({
    em: "338abf9ef1c8793cadc7bcf51ed595338eb727ed9e06ce3d91d566d60b975937", // sha("janedoe@googlemail.com")
    ph: await sha("+201012345678"), fn: await sha("ahmed"), ln: await sha("ali"),
    ct: "cairo", zp: "11511", country: "EG",
  });
});
it("google_ads omits the whole address when postal code is missing (Review Focus 4)", async () => {
  const noZip = normalizeIdentity({ email: "a@b.com", firstName: "Ahmed", lastName: "Ali", country: "EG" });
  expect(Object.keys(await platformMatchKeys("google_ads", noZip, nodeSha256))).toEqual(["em"]);
});
it("ga4: gmail dots removed but +suffix kept", async () => {
  const keys = await platformMatchKeys("ga4", base, nodeSha256);
  expect(keys.em).toBe("77e1d8b954c12009b587de638fc81de43e21aa79163cbf39ac4ce0c21e13e627"); // sha("janedoe+shopping@googlemail.com")
  expect(keys).toMatchObject({ ph: await sha("+201012345678"), ct: "cairo", zp: "11511", country: "EG" });
  expect(keys.externalId).toBeUndefined();
});
it("non-gmail domains keep dots and +suffix on every platform (Review Focus 3)", async () => {
  for (const p of ["meta", "snap", "tiktok", "google_ads", "ga4"] as const) {
    expect(emailForPlatform("jane.doe+x@example.com", p)).toBe("jane.doe+x@example.com");
  }
});
it("Arabic digits hash like Latin digits (Review Focus 1)", async () => {
  const ar = normalizeIdentity({ phone: "٠١٠١٢٣٤٥٦٧٨" }, { defaultCountryCode: "20" });
  expect((await platformMatchKeys("meta", ar, nodeSha256)).ph).toBe(await sha("201012345678"));
});
it("refuses an already-hashed identity", async () => {
  await expect(platformMatchKeys("meta", { ...base, hashStatus: "sha256" }, nodeSha256)).rejects.toThrow(DoubleHashError);
});
it.each([
  ["Ahmed Mohamed Ali", { firstName: "Ahmed", lastName: "Mohamed Ali" }],
  ["  أحمد   علي ", { firstName: "أحمد", lastName: "علي" }],
  ["Ahmed", { firstName: "Ahmed" }],
  ["   ", {}],
  [undefined, {}],
])("splitFullName(%j)", (input, expected) => {
  expect(splitFullName(input)).toEqual(expected);
});
```

- [ ] **Step 2:** `node <pnpm.cjs> --filter @platform/tracking exec vitest run src/pipeline/platform-identity.test.ts` → FAIL.
- [ ] **Step 3: Implement** in `platform-identity.ts`; `ga4` names: remove `\p{N}` from the normalized name before hashing.
- [ ] **Step 4:** PASS; `node <pnpm.cjs> --filter @platform/tracking typecheck` → 0 errors.
- [ ] **Step 5: Commit** `feat(tracking): hash identity in each ad platform's own format`.

---

### Task 3: Morbeh event ids and the once-per-session lead rule

**Files:**
- Create: `packages/tracking/src/ids/event-id.ts`, `packages/tracking/src/ids/event-id.test.ts`
- Create: `packages/tracking/src/leads/lead-emission.ts`, `packages/tracking/src/leads/lead-emission.test.ts`
- Modify: `packages/tracking/src/ids/dedup-id.ts` (remove the `session_minute` strategy and `minuteBucket`)
- Modify: `packages/tracking/src/runtime/ingest-runtime.ts` (`naturalKeyFor` ~line 123; refusal union ~line 65 and the
  code list ~line 81; provided-`dedupId` check before line ~168)
- Modify: `packages/tracking/src/collector/collector.ts:126` (`export const SESSION_TTL_SECONDS`)
- Modify: `packages/tracking/src/envelope/tracking-schema.test.ts:112-121` (delete the `session_minute` case)
- Modify: `packages/tracking/src/index.ts` (drop `minuteBucket`; add the new exports in the plan-B block)

**Interfaces:**

```ts
// ids/event-id.ts
export type BusinessEventKind = "lead" | "order" | "delivery" | "cancel";
export const EVENT_ID_PREFIX = { browser: "mb_", lead: "lead_", order: "ord_", delivery: "dlv_", cancel: "cnl_" } as const;
export function newBrowserEventId(randomUuid: () => string): string;            // "mb_" + uuid (lowercased)
export function businessEventId(kind: BusinessEventKind, ref: string): string;  // throws RangeError on a bad ref
export function isMorbehEventId(value: string): boolean;   // /^(mb|lead|ord|dlv|cnl)_[A-Za-z0-9-]{1,64}$/
export function isAcceptableDedupId(value: string): boolean; // isMorbehEventId || /^[0-9a-f]{64}$/ (legacy hashed ids)

// leads/lead-emission.ts
export interface LeadEmissionLedgerPort { claimOnce(key: string, ttlSeconds: number): Promise<boolean>; }
export const LEAD_SESSION_TTL_SECONDS: number;           // === SESSION_TTL_SECONDS (1800)
export function leadEmissionKey(tenantId: string, sessionId: string): string; // `lead-emit:${tenantId}:${sessionId}`
export function decideLeadEmission(ledger: LeadEmissionLedgerPort,
  input: { readonly tenantId: string; readonly sessionId: string | undefined }): Promise<"emit" | "suppressed">;
export class InMemoryLeadEmissionLedger implements LeadEmissionLedgerPort {
  constructor(clock: { now(): number });               // epoch ms
  claimOnce(key: string, ttlSeconds: number): Promise<boolean>; // false while an unexpired claim exists
}
```

`businessEventId` ref rule: trimmed, `[A-Za-z0-9-]{1,64}`, and not one of `undefined`, `null`, `NA` (case-insensitive) —
otherwise `RangeError`. `decideLeadEmission`: missing/blank `sessionId` → `"emit"` (no session to dedupe on);
otherwise `claimOnce(leadEmissionKey(...), LEAD_SESSION_TTL_SECONDS)` true → `"emit"`, false → `"suppressed"`.
Ingest: when `envelope.dedupId` is provided and `!isAcceptableDedupId(dedupId)` → refusal `{ code: "dedup_id_invalid" }`;
`naturalKeyFor` returns the `order` strategy or `null` (so an event with neither id nor order is refused
`dedup_key_unavailable`, never minute-bucketed).

- [ ] **Step 1: Failing tests**

```ts
// event-id.test.ts
expect(newBrowserEventId(() => "3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toBe("mb_3f2504e0-4f89-41d3-9a0c-0305e82c3301");
expect(businessEventId("lead", "a1b2")).toBe("lead_a1b2");
expect(businessEventId("order", "7c9e6679-7425-40de-944b-e07fc1f90ae7")).toBe("ord_7c9e6679-7425-40de-944b-e07fc1f90ae7");
expect(businessEventId("delivery", "o-1")).toBe("dlv_o-1");
expect(businessEventId("cancel", "o-1")).toBe("cnl_o-1");
for (const bad of ["", "  ", "undefined", "NULL", "na", "{{order.id}}", "%OrderId%", "a".repeat(65)]) {
  expect(() => businessEventId("order", bad)).toThrow(RangeError);
}
expect(isAcceptableDedupId("lead_a1b2")).toBe(true);
expect(isAcceptableDedupId("b12a7c358b87131b5cef5a3e69a5d474532a78e4a3183971b2c70f67c8bb3c8f")).toBe(true);
for (const bad of ["undefined", "{{order.id}}", "%OrderId%", "evt_1", "lead_"]) expect(isAcceptableDedupId(bad)).toBe(false);

// lead-emission.test.ts  (clock starts at Date.parse("2026-11-20T10:00:00.000Z"))
it("first submission in a session emits, the second is suppressed", async () => {
  expect(await decideLeadEmission(ledger, { tenantId: "t-1", sessionId: "s-1" })).toBe("emit");
  expect(await decideLeadEmission(ledger, { tenantId: "t-1", sessionId: "s-1" })).toBe("suppressed");
});
it("a new session emits again", async () => {
  await decideLeadEmission(ledger, { tenantId: "t-1", sessionId: "s-1" });
  expect(await decideLeadEmission(ledger, { tenantId: "t-1", sessionId: "s-2" })).toBe("emit");
});
it("the same session id emits again once the session window has passed", async () => {
  await decideLeadEmission(ledger, { tenantId: "t-1", sessionId: "s-1" });
  clock.advance(1800 * 1000);
  expect(await decideLeadEmission(ledger, { tenantId: "t-1", sessionId: "s-1" })).toBe("emit");
});
it("sessions are tenant-scoped", async () => {
  await decideLeadEmission(ledger, { tenantId: "t-1", sessionId: "s-1" });
  expect(await decideLeadEmission(ledger, { tenantId: "t-2", sessionId: "s-1" })).toBe("emit");
});
it("no session → emit", async () => {
  expect(await decideLeadEmission(ledger, { tenantId: "t-1", sessionId: undefined })).toBe("emit");
  expect(await decideLeadEmission(ledger, { tenantId: "t-1", sessionId: " " })).toBe("emit");
});
it("the TTL is the collector session length", () => {
  expect(LEAD_SESSION_TTL_SECONDS).toBe(SESSION_TTL_SECONDS);
  expect(LEAD_SESSION_TTL_SECONDS).toBe(1800);
});
```

Ingest: add to the existing ingest/runtime test file the cases "provided dedupId `undefined` → refusal
`dedup_id_invalid`" and "no dedupId, no orderId, session present → refusal `dedup_key_unavailable`", plus "provided
`lead_a1b2` is kept verbatim as the record's `dedupId`".

- [ ] **Step 2:** `node <pnpm.cjs> --filter @platform/tracking exec vitest run src/ids src/leads src/runtime src/envelope` → FAIL.
- [ ] **Step 3: Implement** the two modules, the dedup-id/ingest edits, the collector export, the barrel.
- [ ] **Step 4:** `node <pnpm.cjs> --filter @platform/tracking test` → all pass; `typecheck` → 0 errors;
  `rg -n "session_minute|minuteBucket" packages apps services` → no hits.
- [ ] **Step 5: Commit** `feat(tracking): Morbeh event ids and one lead event per session`.
