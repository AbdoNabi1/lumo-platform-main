# Fast Shipping Setup (Plan 3E) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **ملخص للمالك (بالعربي):** إعداد الشحن دلوقتي محتاج خطوات كتير: تعمل منطقة، تدوّر على الدولة، تفتح المحافظات، تعلّم عليها، تحفظ، وبعدين تضيف سعر في شاشة تانية. الخطة دي بتخليه **يتعمل في ثواني**:
>
> - **إعداد سريع:** لو مفيش مناطق شحن، هيظهرلك كارت فيه خانتين بس: **سعر القاهرة والجيزة**، و**سعر باقي المحافظات**. وفيه خانة اختيارية: **شحن مجاني لو الطلب فوق كام**. تدوس "حفظ" والمنطقتين يتعملوا بأسعارهم.
> - **"إنشاء منطقة" في شاشة واحدة:** المنطقة وسعرها في نفس الشاشة، مش شاشتين.
> - **اختصارات للمحافظات:**
>   - "القاهرة الكبرى" (القاهرة والجيزة والقليوبية).
>   - "كل المحافظات الباقية": أي محافظة مش في منطقة تانية.
>   - محافظات بلدك بتبقى مفتوحة على طول، من غير بحث.
> - **اسم المنطقة بيتكتب لوحده** من اختيارك، مثلاً "القاهرة والجيزة" أو "باقي محافظات مصر"، وتقدر تغيّره.
> - **اسم السعر:** الاسم ده هو اللي العميل بيشوفه في الـ checkout، ولازم يكون كلام مش رقم. فهيكون جاهز "شحن عادي" ومعاه مدة التوصيل، وتقدر تختار "شحن سريع" أو تكتب اسم من عندك. ولو كتبت رقم بس (زي "50") هتظهرلك رسالة.
>
> مفيش migration.

**Goal:** A merchant sets up Shopify-style shipping in seconds. One-click quick setup for an empty shop; zone + first rate in one dialog; province shortcuts; auto-suggested zone names; customer-facing rate names that are words, not prices.

**Architecture:**

- **Backend (services/shipping, apps/admin):** `CreateZone` accepts optional `rates: RateFields[]` and adds them to the new zone **inside the same unit of work** before the save, so a zone and its first rate are atomic. The route's `zoneBody` gains `rates: z.array(rateBody).max(20).optional()`. No other endpoint changes; no migration.
- **Pure helpers (admin-web `lib/shipping/`):**
  - `remainingProvinces(country, zones, exceptZoneId)`: the provinces of a country not held by any other zone.
  - `suggestZoneName(selection, zones, locale)`: the zone's suggested name.
  - `quickSetupPlan(input)`: the zone + rate payloads for quick setup.
  - `RATE_PRESETS`: the rate presets.
- **UI (admin-web `components/settings/shipping/`):**
  - A quick-setup card shown when the shop has **zero** zones.
  - The zone dialog gains shortcut chips, auto-expanded home country, an auto name and (on create only) an inline first rate.
  - The rate dialog gains presets and a numeric-name warning.

**Tech Stack:** TypeScript, vitest, Next.js 15, React 19, `@platform/ui`, `@platform/regions`.

**Spec:**

- Owner screenshot, 2026-10-13: one zone "cairo" (Egypt, 1 of 27 governorates) with a rate **named "50"** at EGP 50.00. The rate name is what customers see at checkout.
- Owner: "ظبطت جدول الشحن خليه اسهل وايسر في غضون ثواني يتعمل".
- Owner's intended setup (2026-10-11): "القاهرة والجيزة" at 50, "باقي المحافظات" at 75.

## Global Constraints

Same as Plans 3A–3D. Every task implicitly includes these.

### Git and branch

- Branch `morbeh/w0-w17-w12`. No force-push. No `--no-verify`. **Never touch the lint warning cap.**
- Never stage `.claude/worktrees/`.
- Never use `git stash`, `git add -A`, `git add .` or `git add -N`.
- Commit lines at most 100 characters, lowercase subject.
- End every commit with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Check `git diff --cached --stat` before every commit. Run prettier only on files you changed (never on a folder).

### Database

- **No migration.** If one seems needed, STOP and ask.
- **Never connect to any database.**
- **Never set `TENANT_MODE=multi`.**
- **No guard exemptions.** Do not upgrade Prisma.

### App rules

- Runtime API calls only from server code (server actions).
- Both message files (`en.ts`, `ar.ts`) get every key. Logical RTL classes only (`ps-`, `me-`, `start-`…).
- **Money:** `formatCurrency` for display. Inputs are major units; convert to minor with the existing shipping helpers, never with floats.
- **Save buttons:** follow the existing pattern (disabled while pending). No `autoFocus`.
- **No async function without `await`.** No new warnings in touched files.
- Keep the Plan 3C rules: a country or province can only be in one zone; province beats country beats rest of world.

### Commands

Per-package `pnpm.cmd --filter <pkg> run test|typecheck|lint`, sequentially. Never run the full typecheck and full test at once.

---

### Task 1: Create a zone with its rates in one call

**Files:**

- Modify `services/shipping/src/application/shipping-zones.use-cases.ts`. `CreateZoneInput` gains `readonly rates?: readonly RateFields[]`.
- In `CreateZone.execute`, after `ShippingZone.create`, for each rate, `zone.addRate(newId, rateFields(rate))` inside `attempt`. A rate error fails the whole call and nothing is saved.
- Modify `apps/admin/src/http/shipping-zones-routes.ts`. `zoneBody` gains `rates: z.array(rateBody).max(20).optional()`. `rateBody` must be declared before `zoneBody`; reorder if needed.
- Tests:
  - `shipping-zones.use-cases.test.ts`:
    - creates a zone with two rates, then lists them in order;
    - a bad rate (empty name, or a negative price) returns the domain error and **no zone exists** afterwards;
    - no `rates` still works exactly as before.
  - The routes test: the body with `rates` is passed through, and 21 rates gives 422.

- [ ] Write the failing tests, run them, and see them fail.
- [ ] Implement, then run `pnpm.cmd --filter @platform/shipping run test`, then the admin package tests.
- [ ] Commit: `feat(shipping): create a zone and its first rates in one atomic call`.

---

### Task 2: Pure helpers (admin-web `lib/shipping/`)

**Files:** extend `apps/admin-web/src/lib/shipping/zones.ts` (or a new `quick-setup.ts`), with tests next to it.

- **`remainingProvinces(code, zones, exceptZoneId): string[]`:** the province codes of `code` (from `@platform/regions`) that no other zone holds. A zone holding the whole country holds them all.
- **`GREATER_CAIRO = ["EG-C", "EG-GZ", "EG-KB"]`** and **`CAIRO_GIZA = ["EG-C", "EG-GZ"]`.**
- **`suggestZoneName(selection, zones, exceptZoneId, locale): string`:**
  - one country, whole → the country name;
  - one country, 1–3 provinces → the province names joined: ar "القاهرة والجيزة" (`و` before the last), en "Cairo and Giza";
  - one country, the provinces equal `remainingProvinces` and other zones hold some of that country → ar "باقي محافظات مصر" / en "Rest of Egypt". Use the country noun for SA/AE: "باقي مناطق السعودية", "باقي إمارات الإمارات" or the existing nouns;
  - several countries → the first two names + "+N";
  - rest of world → the existing `restOfWorld` label;
  - empty → "".
- **`RATE_PRESETS`:**
  - `standard`: en "Standard" / ar "شحن عادي", description en "2–4 business days" / ar "من 2 لـ 4 أيام عمل";
  - `express`: en "Express" / ar "شحن سريع", description en "1–2 business days" / ar "من يوم لـ يومين عمل";
  - `custom`: empty.

  The preset fills the fields **in the admin's current locale**. They are editable text, not keys.

- **`looksLikePrice(name): boolean`:** true when the trimmed name is only digits, separators, currency symbols or codes (e.g. "50", "50 EGP", "ج.م 50", "٥٠"). Used for a warning only, never a block.
- **`quickSetupPlan({ country, cityPriceMinor, restPriceMinor, freeOverMinor, zones, locale })`:** returns up to two zone payloads, each `{ name, countries, rates }`.
  - **EG:**
    - zone 1 is `CAIRO_GIZA` (name from `suggestZoneName`) with a "Standard" rate at `cityPriceMinor`;
    - zone 2 is the remaining governorates (name "باقي محافظات مصر") at `restPriceMinor`.
  - **SA/AE:** one zone, the whole country, at `cityPriceMinor`; `restPriceMinor` is ignored.
  - **When `freeOverMinor` is set,** each zone gets a second rate. Its name is ar "شحن مجاني" / en "Free shipping", at price 0, with condition `{ type: "orderPrice", minMinor: freeOverMinor }`. The standard rate gets `maxMinor: freeOverMinor`, so the customer sees exactly one option.
  - **Rates** carry the Standard preset description.
- Tests cover every branch above, plus Arabic and English names.

- [ ] Write the failing tests first, then implement.
- [ ] Commit: `feat(admin-web): shipping helpers for names, presets and quick setup`.

---

### Task 3: Quick setup card

**Files:** a new `components/settings/shipping/quick-setup.tsx` and its test, rendered by `zones-view.tsx` **only when there are zero zones**, above the empty state. A new server action `quickSetupAction` in `app/settings/shipping/actions.ts`.

- **Fields:**
  - country select (EG / SA / AE). The default comes from the store currency: EGP→EG, SAR→SA, AED→AE, otherwise EG. Read the currency in `page.tsx` from the existing store settings call, or from what the page already loads; do not add a second fetch if one exists.
  - EG: "Cairo and Giza" price and "All other governorates" price.
  - SA/AE: a single "Whole country" price.
  - optional "Free shipping on orders over".
  - Prices in major units with the currency code shown; placeholders `50`, `75`.
- **Submit:** the action validates the fields and builds the plan with `quickSetupPlan`. Then it POSTs each zone **with its rates** (Task 1), sequentially, each with its own idempotency key.
  - If the first succeeds and the second fails, answer an error naming what was saved and what was not ("Cairo and Giza is saved. The other governorates were not — add them with Create zone."). Then revalidate so the page shows the saved zone.
- **Copy (both locales):**
  - title "Set up shipping in seconds" / "جهّز الشحن في ثواني";
  - one-line description;
  - button "Save shipping rates" / "احفظ أسعار الشحن".
- **Tests:**
  - **The card:**
    - hidden when zones exist;
    - the default country follows the currency;
    - EG shows two price fields and SA one;
    - submit is disabled until the required prices are filled.
  - **The action:**
    - two POSTs with the exact payloads;
    - the partial-failure message;
    - a validation error for a negative or empty price.

- [ ] Write the failing tests first, then implement.
- [ ] Commit: `feat(admin-web): quick shipping setup for a shop with no zones`.

---

### Task 4: Zone dialog — shortcuts, auto name, first rate

**File:** `components/settings/shipping/zone-dialog.tsx` and its test.

- **Home country first and open.** The store's country (from the currency, as in Task 3, passed as a prop) is shown at the top of the list with its provinces **expanded by default**. The search still works.
- **Shortcut chips** above the list, for countries with provinces. Each one is a `type="button"` that sets the selection, skips provinces held by other zones, and stays disabled when it would add nothing.
  - EG: "Cairo and Giza", "Greater Cairo", and "All remaining governorates".
  - SA/AE: only "All remaining".
- **Auto name.** While the merchant has not typed in the name field, the name follows `suggestZoneName(selection…)`. Once they type, it stops following. When editing an existing zone, the name is never auto-changed.
- **First rate inline (create only).** Below the regions, add a "Shipping rate" section:
  - a preset select (Standard / Express / Custom), defaulting to Standard, which fills the name and the description;
  - a rate name, a price, and a description (transit time, optional);
  - an "Add free shipping over" toggle with an amount, which works like quick setup and sets max/min.

  The form posts `rates` as one JSON hidden field. `saveZoneAction` parses and validates it and sends it with the create call. When editing, the section is not shown (rates are edited on the zone card as today).

- **Numeric-name warning.** Under the rate name, when `looksLikePrice(name)`, show this (role="status", not blocking): "Customers see this name at checkout. Use words like 'Standard', and put the amount in Price." / "العميل بيشوف الاسم ده في الدفع. اكتب اسم زي 'شحن عادي'، والمبلغ في خانة السعر."
- **Tests:**
  - each chip's selection, including skipping provinces taken by another zone;
  - the auto name follows and stops after typing;
  - an edit dialog keeps its name;
  - the create dialog posts `rates` with the preset values;
  - the free-over toggle posts two rates with the conditions;
  - the warning shows for "50" and not for "Standard".

- [ ] Write the failing tests first, then implement.
- [ ] Commit: `feat(admin-web): zone dialog with shortcuts, auto name and its first rate`.

---

### Task 5: Rate dialog — presets and warning

**File:** `components/settings/shipping/rate-dialog.tsx` and its test.

- The same preset select as Task 4. Its default is **Standard** for a new rate, and **Custom** when editing, so the existing values stay. Reuse one component from Task 4 (`rate-fields.tsx`) instead of duplicating.
- The same numeric-name warning. **Editing the owner's existing "50" rate shows it.**
- The zone card's rate row shows the description under the name, when there is one.
- Tests: the preset fills the fields; editing keeps the values; the warning shows.

- [ ] Write the failing tests first, then implement.
- [ ] Commit: `feat(admin-web): rate presets and a warning for price-like rate names`.

---

### Task 6: Docs and push

- Note in `docs/KNOWN_GAPS.md` that rate names are single-language merchant text. Bilingual rate names are like Shopify's Translate & Adapt: a new G-number, Phase 2.
- Run all gates for every touched package (shipping, admin, admin-web), sequentially: typecheck, lint (no new warnings in touched files) and test. Then run `pnpm arch`.
- Push to `morbeh/w0-w17-w12` (no migration).
- **Report in Arabic.** Include what the owner should click to verify:
  1. The existing "50" rate shows the warning. Rename it to "شحن عادي".
  2. To try quick setup, delete the "cairo" zone. The card appears; fill in 50 and 75 and save. Two zones appear.
  3. In the store's checkout, an address in Giza shows "شحن عادي — 50", and Alexandria shows 75.
