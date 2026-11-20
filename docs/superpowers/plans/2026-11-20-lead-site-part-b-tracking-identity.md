# Lead Site Part B — Tracking Identity Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** `OPUS: PENDING · Sol: PENDING` (revised after plan review 1 — see `2026-11-20-lead-site-plan-review-1.md`,
section "Opus triage (round 1)")

**Goal:** the pure building blocks every later tracking plan uses: correct phone and name normalization for Egyptian and
Gulf input, identity hashed **in the exact form each ad platform expects**, Morbeh event-id generation and recognition,
and the "one lead event per session" decision.

**Architecture:** everything here is pure code in `packages/tracking` with injected ports (`HashPort`, a ledger port).
Nothing sends to a platform, and **no runtime path changes**: the ingest pipeline, the `session_minute` fallback and
the shared `hashIdentity` stay exactly as they are. Plan D wires these modules in (handoff list in the spec).

**Tech stack:** TypeScript, vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-20-lead-site-and-tracking-design.md` (decisions 3, 4, 6, the identity table, and
"Handoff to Plans C and D"). Official sources: workbook `Morbeh-Tracking-Plan-v4.xlsx`, sheet "المصادر الرسمية" ([1] Meta
customer info, [8] Meta advanced matching, [9] TikTok web setup, [15] Snap parameters, [17] Snap dedup, [20] Google Ads
EC web, [22] Data Manager formatting, [23] GA4 MP user data, [32] TikTok advanced matching).

**Base:** branch `morbeh/lead-site`; no file in common with Plan A, so it may run alongside it.

## Implementers

Task 1 `impl-terra` · Task 2 `impl-sonnet` · Task 3 `impl-terra`.

## Global Constraints

- Hash = SHA-256 over UTF-8, lowercase hex, through the injected `HashPort` (`packages/tracking/src/ids/dedup-id.ts`).
- Tests use a real hasher, defined in each new test file:
  `const nodeSha256: HashPort = { sha256Hex: async (s) => createHash("sha256").update(s, "utf8").digest("hex") };`
  (`import { createHash } from "node:crypto"`) and `const sha = (s: string) => nodeSha256.sha256Hex(s);`.
- New test files: `beforeEach(() => { expect.hasAssertions(); })`; every assertion sits inside a named `it`/`it.each`.
- Never hash: IP, user agent, `fbp`, `fbc`, `ttclid`, `ttp`, `sc_click_id`, `sc_cookie1`, gclid/gbraid/wbraid.
- Tool output may mask phone numbers as `+201****5678`; the literal values in this plan are the full numbers
  (e.g. `+201012345678`). Grep the file before "fixing" a masked value.
- Commands run as printed (bash): `cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs …`.
- Commit rules as in Plan A. `packages/*` must not import from `apps/*`.

## Review Focus

1. A phone typed with Arabic digits `٠١٠١٢٣٤٥٦٧٨` hashes identically to `01012345678`.
2. A phone already carrying the country code (`201012345678`, `00201012345678`) never gets it prepended twice.
3. The gmail rule applies only to Google Ads (dots and `+suffix`) and GA4 (dots only), only for gmail.com /
   googlemail.com.
4. Google Ads omits the whole address (names included) unless first name, last name, country and postal code all
   exist ([20]).
5. A value that formats to empty (GA4 name of digits only, blank external id) never becomes `sha256("")`.

---

### Task 1: normalization fixes — digits, phone forms, Arabic names

**Files:**
- Modify: `packages/tracking/src/pipeline/normalization.ts`
- Test: `packages/tracking/src/pipeline/pipeline.test.ts` — add new describes; **do not edit** the existing assertions
  (lines ~59–77 and ~111–134 must pass unchanged).

**Interfaces:**
- Produces `export function toLatinDigits(value: string): string` — maps U+0660–U+0669 and U+06F0–U+06F9 to `0-9`,
  leaves everything else.
- Produces `export const NATIONAL_NUMBER_LENGTHS: Readonly<Record<string, readonly number[]>> = { "20": [9, 10], "966": [9], "971": [8, 9] };`
  (EG landline 9 / mobile 10, SA 9, UAE landline 8 / mobile 9 national digits.)
- `normalizePhone(phone?, defaultCountryCode?)` and `normalizeName(name?)` keep their signatures.

`normalizePhone` algorithm (exact order):
1. `clean(phone)`; `undefined`/blank → `undefined`. Then `toLatinDigits`.
2. Leading `+` → international: `digits` = all digits; if empty, first digit `0`, or length outside 8–15 → `undefined`;
   else `+${digits}`.
3. No `+` and digits start with `00` → drop the `00` and apply rule 2's checks to the rest.
4. Otherwise national: `cc` = digits of `defaultCountryCode`; empty/absent `cc` → `undefined` (unchanged behavior).
   If `NATIONAL_NUMBER_LENGTHS[cc]` exists and `digits.startsWith(cc)` and `digits.length - cc.length` is in it →
   `+${digits}`. Else strip leading `0`s → `national`; if the lengths exist, `national.length` must be in them, else
   `undefined`; for an unknown `cc` the total digit count (`cc + national`, excluding `+`) must be 8–15.
   Result `+${cc}${national}`.

`normalizeName`: additionally remove U+0640 (tatweel); the existing `[^\p{L}\p{N}]` removal already drops diacritics.

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
    ["0223456789", "20", "+20223456789"],
    ["0501234567", "966", "+966501234567"],
    ["966501234567", "966", "+966501234567"],
    ["0501234567", "971", "+971501234567"],
    ["07911123456", "44", "+447911123456"],
  ])("%s with cc %s → %s", (input, cc, expected) => {
    expect(normalizePhone(input, cc)).toBe(expected);
  });
  it("accepts an 00-prefixed international number without a default country", () => {
    expect(normalizePhone("00201012345678")).toBe("+201012345678");
  });
  it.each([
    ["010123456", "20"],        // 8 national digits
    ["010123456789", "20"],     // 11 national digits
    ["+0201012345678", "20"],   // international starting with 0
    ["0000201012345678", "20"], // 00 then a leading 0
    ["   ", "20"],
    ["01012345678", ""],        // no usable country
    ["0123", "44"],             // unknown cc, total 5 digits
  ])("%j with cc %j → undefined", (input, cc) => {
    expect(normalizePhone(input, cc)).toBeUndefined();
  });
});
describe("normalizeName — Arabic", () => {
  it("removes tatweel and diacritics", () => {
    expect(normalizeName("أحمـــد")).toBe("أحمد");
    expect(normalizeName("مُحَمَّد")).toBe("محمد");
  });
});
describe("toLatinDigits", () => {
  it("converts Arabic-Indic and Persian digits only", () => {
    expect(toLatinDigits("٠١٢٣٤٥٦٧٨٩ ۰۱۲ abc")).toBe("0123456789 012 abc");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/tracking exec vitest run src/pipeline/pipeline.test.ts
```

- [ ] **Step 3: Implement** the algorithm above.
- [ ] **Step 4: Run, expect PASS** — the Step 2 command (old and new tests), then
  `… --filter @platform/tracking typecheck` → 0 errors.
- [ ] **Step 5: Commit** `fix(tracking): normalize Egyptian and Gulf phone input and Arabic names`.

---

### Task 2: per-platform match keys

**Files:**
- Create: `packages/tracking/src/pipeline/platform-identity.ts`, `packages/tracking/src/pipeline/platform-identity.test.ts`
- Modify: `packages/tracking/src/index.ts` (new commented export block "Lead-site plan B — per-platform match keys")

**Interfaces:**
- Consumes: Task 1; the input identity is the output of `normalizeIdentity` (`hashStatus: "raw"`); `HashPort`;
  `DoubleHashError` from `./hashing` (constructor `(status: HashStatus)`).
- Produces:

```ts
export type MatchPlatform = "meta" | "snap" | "tiktok" | "google_ads" | "ga4";
export interface PlatformMatchKeys {   // every value is final: a hash or a plain value, per the table below
  readonly em?: string; readonly ph?: string; readonly fn?: string; readonly ln?: string;
  readonly ct?: string; readonly st?: string; readonly zp?: string; readonly country?: string;
  readonly externalId?: string;
}
export function splitFullName(full: string | undefined): { readonly firstName?: string; readonly lastName?: string };
export function emailForPlatform(email: string, platform: MatchPlatform): string; // input already normalized
export function phoneForPlatform(e164: string, platform: MatchPlatform): string;  // input "+<digits>"
export function platformMatchKeys(platform: MatchPlatform, identity: IdentityContext, hasher: HashPort): Promise<PlatformMatchKeys>;
```

Rules: `emailForPlatform` — `google_ads`: for `gmail.com`/`googlemail.com` remove every `.` and the first `+` with
everything after it from the local part; `ga4`: same domains, dots only; others and other domains: unchanged.
`phoneForPlatform` — `meta`/`snap`: drop the `+`; others unchanged. `splitFullName`: collapse whitespace; first token →
`firstName`, the rest joined with one space → `lastName`; absent parts are omitted.

| key | meta, snap | tiktok | google_ads | ga4 |
|---|---|---|---|---|
| em, ph | hash | hash | hash | hash |
| fn, ln | hash | hash | hash, only with full address | remove `\p{N}`, then hash |
| ct, st | hash | plain | plain, only with full address | plain |
| zp | hash | hash | plain, only with full address | plain |
| country | hash (`eg`) | plain (`eg`) | plain upper (`EG`), only with full address | plain upper (`EG`) |
| externalId | trim, hash | trim, hash | omitted | omitted |

"Full address" = `firstName`, `lastName`, `country`, `postalCode` all present after formatting; otherwise
`google_ads` omits fn, ln, ct, st, zp and country (em and ph stay). A value that is empty **after** per-platform
formatting is omitted — never hashed. `identity.hashStatus !== "raw"` → `throw new DoubleHashError(identity.hashStatus ?? "mixed")`.
Callers must check the status before calling `normalizeIdentity`, which sets `raw` (documented in the module header).

- [ ] **Step 1: Failing tests.** Fixture:
  `const base = normalizeIdentity({ email: " Jane.Doe+Shopping@googlemail.com ", phone: "01012345678", firstName: "Ahmed", lastName: "Ali", city: "Cairo", state: "Giza", country: "EG", postalCode: "11511", externalId: " cust-123 " }, { defaultCountryCode: "20" });`

```ts
it("pins literal digests so the hasher itself is checked", async () => {
  expect(await sha("201012345678")).toBe("b12a7c358b87131b5cef5a3e69a5d474532a78e4a3183971b2c70f67c8bb3c8f");
  expect(await sha("+201012345678")).toBe("0895f44c7a43ae484d10b8509021516091079927afc18baa37fad1a70f35c01d");
});
it("meta: everything hashed, phone without +", async () => {
  expect(await platformMatchKeys("meta", base, nodeSha256)).toEqual({
    em: await sha("jane.doe+shopping@googlemail.com"), ph: await sha("201012345678"),
    fn: await sha("ahmed"), ln: await sha("ali"), ct: await sha("cairo"), st: await sha("giza"),
    zp: await sha("11511"), country: await sha("eg"), externalId: await sha("cust-123"),
  });
});
it("snap equals meta", async () => {
  expect(await platformMatchKeys("snap", base, nodeSha256)).toEqual(await platformMatchKeys("meta", base, nodeSha256));
});
it("tiktok: phone with +, city/state/country plain", async () => {
  expect(await platformMatchKeys("tiktok", base, nodeSha256)).toEqual({
    em: await sha("jane.doe+shopping@googlemail.com"), ph: await sha("+201012345678"),
    fn: await sha("ahmed"), ln: await sha("ali"), ct: "cairo", st: "giza", zp: await sha("11511"),
    country: "eg", externalId: await sha("cust-123"),
  });
});
it("google_ads: gmail dots and +suffix removed, plain address parts, no external id", async () => {
  expect(await platformMatchKeys("google_ads", base, nodeSha256)).toEqual({
    em: "338abf9ef1c8793cadc7bcf51ed595338eb727ed9e06ce3d91d566d60b975937", // sha("janedoe@googlemail.com")
    ph: await sha("+201012345678"), fn: await sha("ahmed"), ln: await sha("ali"),
    ct: "cairo", st: "giza", zp: "11511", country: "EG",
  });
});
it.each(["firstName", "lastName", "country", "postalCode"] as const)(
  "google_ads drops the whole address when %s is missing", async (field) => {
    const partial = normalizeIdentity({ email: "a@b.com", phone: "+201012345678", firstName: "Ahmed",
      lastName: "Ali", country: "EG", postalCode: "11511", [field]: undefined });
    expect(Object.keys(await platformMatchKeys("google_ads", partial, nodeSha256)).sort()).toEqual(["em", "ph"]);
  });
it("ga4: gmail dots removed, +suffix kept, digits removed from names", async () => {
  const id = normalizeIdentity({ email: "Jane.Doe+Shopping@googlemail.com", firstName: "Ali2", lastName: "123" });
  const keys = await platformMatchKeys("ga4", id, nodeSha256);
  expect(keys.em).toBe("77e1d8b954c12009b587de638fc81de43e21aa79163cbf39ac4ce0c21e13e627"); // sha("janedoe+shopping@googlemail.com")
  expect(keys.fn).toBe(await sha("ali"));
  expect(keys.ln).toBeUndefined();
});
it("gmail.com gets the same rule as googlemail.com", () => {
  expect(emailForPlatform("jane.doe+x@gmail.com", "google_ads")).toBe("janedoe@gmail.com");
  expect(emailForPlatform("jane.doe+x@gmail.com", "ga4")).toBe("janedoe+x@gmail.com");
});
it.each(["meta", "snap", "tiktok", "google_ads", "ga4"] as const)("%s keeps non-gmail addresses verbatim", (p) => {
  expect(emailForPlatform("jane.doe+x@example.com", p)).toBe("jane.doe+x@example.com");
});
it("a blank external id is omitted, not hashed", async () => {
  const id = normalizeIdentity({ email: "a@b.com", externalId: "   " });
  expect((await platformMatchKeys("tiktok", id, nodeSha256)).externalId).toBeUndefined();
});
it("Arabic digits hash like Latin digits", async () => {
  const ar = normalizeIdentity({ phone: "٠١٠١٢٣٤٥٦٧٨" }, { defaultCountryCode: "20" });
  expect((await platformMatchKeys("meta", ar, nodeSha256)).ph).toBe(await sha("201012345678"));
});
it.each(["sha256", "mixed", undefined] as const)("refuses hashStatus %j", async (status) => {
  await expect(platformMatchKeys("meta", { ...base, hashStatus: status }, nodeSha256)).rejects.toThrow(DoubleHashError);
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

- [ ] **Step 2: Run, expect FAIL**

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/tracking exec vitest run src/pipeline/platform-identity.test.ts
```

- [ ] **Step 3: Implement** `platform-identity.ts`.
- [ ] **Step 4: Run, expect PASS** — Step 2 command, then `… --filter @platform/tracking typecheck` → 0 errors.
- [ ] **Step 5: Commit** `feat(tracking): hash identity in each ad platform's own format`.

---

### Task 3: Morbeh event ids and the once-per-session lead decision (pure modules only)

**Files:**
- Create: `packages/tracking/src/ids/event-id.ts`, `packages/tracking/src/ids/event-id.test.ts`
- Create: `packages/tracking/src/leads/lead-emission.ts`, `packages/tracking/src/leads/lead-emission.test.ts`
- Modify: `packages/tracking/src/index.ts` (add to the plan-B export block)
- **Not touched in this plan:** `ids/dedup-id.ts`, `runtime/ingest-runtime.ts`, `collector/collector.ts` (Plan D).

**Interfaces:**

```ts
// ids/event-id.ts
export type BusinessEventKind = "lead" | "order" | "delivery" | "cancel";
export const EVENT_ID_PREFIX = { browser: "mb_", lead: "lead_", order: "ord_", delivery: "dlv_", cancel: "cnl_" } as const;
export function isBusinessRef(ref: string): boolean;  // /^[A-Za-z0-9-]{1,64}$/ and not undefined|null|na (case-insensitive)
export function newBrowserEventId(randomUuid: () => string): string; // "mb_" + lowercased UUID; RangeError if not a UUID
export function businessEventId(kind: BusinessEventKind, ref: string): string; // trims ref; RangeError unless isBusinessRef
export function isMorbehEventId(value: string): boolean;
//   true for "mb_" + canonical lowercase UUID (8-4-4-4-12 hex), or (lead|ord|dlv|cnl)_ + a ref passing isBusinessRef
export function checkProvidedDedupId(value: unknown): "absent" | "valid" | "invalid";
//   undefined → "absent"; a string that isMorbehEventId or is 64 lowercase hex (legacy hashed ids) → "valid";
//   anything else (null, "", "undefined", numbers, objects, malformed strings) → "invalid". Never throws.

// leads/lead-emission.ts
export interface LeadEmissionLedgerPort {
  /** Atomic: true for the first claim of `key` while it is stored, false afterwards (production: Redis SET NX EX, Plan C). */
  claimOnce(key: string, ttlSeconds: number): Promise<boolean>;
}
export const LEAD_CLAIM_TTL_SECONDS = 172_800; // 48 h: storage bound only (see below)
export function leadEmissionKey(tenantId: string, sessionId: string): string; // `lead-emit:${tenantId}:${sessionId}`
export function decideLeadEmission(ledger: LeadEmissionLedgerPort,
  input: { readonly tenantId: string; readonly sessionId: string }): Promise<"emit" | "suppressed">;
//   blank tenantId or sessionId → RangeError (the caller must resolve or mint the collector session first)
export class InMemoryLeadEmissionLedger implements LeadEmissionLedgerPort {
  constructor(clock: { now(): number }); // epoch ms
  claimOnce(key: string, ttlSeconds: number): Promise<boolean>;
}
```

Why the TTL is not the session length (Plan review 1, finding 8): the collector re-issues `morbeh_sid` on every
request, so a session lasts as long as the visitor stays active, and after 30 minutes of inactivity the next request
gets a **new** session id. Suppression is therefore keyed by the session id itself; an expired session can never
reappear under the same id. The 48 h TTL only bounds storage.

- [ ] **Step 1: Failing tests**

```ts
// event-id.test.ts
it("builds a browser id from a UUID", () => {
  expect(newBrowserEventId(() => "3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toBe("mb_3f2504e0-4f89-41d3-9a0c-0305e82c3301");
  expect(() => newBrowserEventId(() => "x")).toThrow(RangeError);
});
it("builds business ids", () => {
  expect(businessEventId("lead", " a1b2 ")).toBe("lead_a1b2");
  expect(businessEventId("order", "7c9e6679-7425-40de-944b-e07fc1f90ae7")).toBe("ord_7c9e6679-7425-40de-944b-e07fc1f90ae7");
  expect(businessEventId("delivery", "o-1")).toBe("dlv_o-1");
  expect(businessEventId("cancel", "o-1")).toBe("cnl_o-1");
});
it.each(["", "  ", "undefined", "NULL", "na", "{{order.id}}", "%OrderId%", "a".repeat(65), "o_1"])(
  "rejects the business ref %j", (bad) => { expect(() => businessEventId("order", bad)).toThrow(RangeError); });
it.each([
  [undefined, "absent"],
  ["lead_a1b2", "valid"],
  ["mb_3f2504e0-4f89-41d3-9a0c-0305e82c3301", "valid"],
  ["b12a7c358b87131b5cef5a3e69a5d474532a78e4a3183971b2c70f67c8bb3c8f", "valid"],
  [null, "invalid"], ["", "invalid"], ["undefined", "invalid"], ["lead_undefined", "invalid"],
  ["ord_NULL", "invalid"], ["cnl_NA", "invalid"], ["mb_x", "invalid"], ["{{order.id}}", "invalid"],
  ["%OrderId%", "invalid"], ["evt_1", "invalid"], ["lead_", "invalid"], [42, "invalid"], [{}, "invalid"],
])("checkProvidedDedupId(%j) → %s", (value, expected) => {
  expect(checkProvidedDedupId(value)).toBe(expected);
});

// lead-emission.test.ts — fresh clock and ledger in beforeEach:
//   let nowMs = Date.parse("2026-11-20T10:00:00.000Z"); const clock = { now: () => nowMs };
//   ledger = new InMemoryLeadEmissionLedger(clock); const at = (iso: string) => { nowMs = Date.parse(iso); };
it("an active session keeps suppressing: 10:00 submit, 10:31 submit, same session id", async () => {
  expect(await decideLeadEmission(ledger, { tenantId: "t-1", sessionId: "s-1" })).toBe("emit");
  at("2026-11-20T10:31:00.000Z");
  expect(await decideLeadEmission(ledger, { tenantId: "t-1", sessionId: "s-1" })).toBe("suppressed");
});
it("a new session id (after inactivity) emits again", async () => {
  await decideLeadEmission(ledger, { tenantId: "t-1", sessionId: "s-1" });
  at("2026-11-20T11:05:00.000Z");
  expect(await decideLeadEmission(ledger, { tenantId: "t-1", sessionId: "s-2" })).toBe("emit");
});
it("sessions are tenant-scoped", async () => {
  await decideLeadEmission(ledger, { tenantId: "t-1", sessionId: "s-1" });
  expect(await decideLeadEmission(ledger, { tenantId: "t-2", sessionId: "s-1" })).toBe("emit");
});
it("two concurrent submits in one session emit once", async () => {
  const both = await Promise.all([
    decideLeadEmission(ledger, { tenantId: "t-1", sessionId: "s-1" }),
    decideLeadEmission(ledger, { tenantId: "t-1", sessionId: "s-1" }),
  ]);
  expect([...both].sort()).toEqual(["emit", "suppressed"]);
});
it("the claim expires only after the storage TTL", async () => {
  await decideLeadEmission(ledger, { tenantId: "t-1", sessionId: "s-1" });
  at("2026-11-22T09:59:59.000Z");
  expect(await decideLeadEmission(ledger, { tenantId: "t-1", sessionId: "s-1" })).toBe("suppressed");
  at("2026-11-22T10:00:00.000Z");
  expect(await decideLeadEmission(ledger, { tenantId: "t-1", sessionId: "s-1" })).toBe("emit");
});
it.each([["", "s-1"], ["t-1", ""], ["t-1", "  "]])("refuses tenant %j / session %j", async (tenantId, sessionId) => {
  await expect(decideLeadEmission(ledger, { tenantId, sessionId })).rejects.toThrow(RangeError);
});
it("uses the documented key", () => {
  expect(leadEmissionKey("t-1", "s-1")).toBe("lead-emit:t-1:s-1");
  expect(LEAD_CLAIM_TTL_SECONDS).toBe(172800);
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/tracking exec vitest run src/ids/event-id.test.ts src/leads/lead-emission.test.ts
```

- [ ] **Step 3: Implement** both modules and the barrel exports. In-memory `claimOnce` is synchronous inside the
  promise (check-and-set before any `await`), so concurrent calls cannot both win.
- [ ] **Step 4: Run, expect PASS**

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/tracking test
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/tracking typecheck
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs arch
```

  Expected: all pass, 0 type errors, `arch` clean.
- [ ] **Step 5: Commit** `feat(tracking): Morbeh event ids and the once-per-session lead decision`.
