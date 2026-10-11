# Store Settings, Shipping, Taxes and Order Reservation (Plan 3C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **ملخص للمالك (بالعربي):** الخطة دي بتعمل 4 حاجات **بنفس تصميم شوبيفاي من الأول**، عشان ما نرجعش نغيّرها:
>
> 1. **الإعدادات العامة للمتجر**: اسم المتجر، وإيميل التواصل، و**عملة المتجر** (جنيه مصري مثلاً)، والمنطقة الزمنية، ووحدة الوزن (كيلو/جرام).
>    - كل أسعار المنتجات بتبقى بعملة المتجر.
>    - لو غيّرت العملة، **الأرقام نفسها ما بتتغيرش** (زي شوبيفاي)، اللي بيتغير اسم العملة بس. والطلبات القديمة بتفضل بعملتها.
> 2. **الشحن والتوصيل** (زي شوبيفاي بالظبط):
>    - **مناطق شحن**، مثلاً "القاهرة والجيزة" أو "باقي المحافظات" أو "السعودية". كل منطقة فيها دول ومحافظات.
>    - جوّه كل منطقة **أسعار**، مثلاً "شحن عادي 50 جنيه" أو "سريع 100 جنيه". السعر ممكن يبقى مشروط:
>      - **بقيمة الطلب**، مثلاً شحن مجاني فوق 1000 جنيه؛
>      - أو **بالوزن**، مثلاً من 0 لـ 5 كيلو.
>    - في صفحة الدفع: الدول اللي بتظهر هي اللي إنت بتشحن لها بس، وفيه اختيار **المحافظة**، والأسعار بتطلع حسب المحافظة.
> 3. **الضرايب** (زي شوبيفاي):
>    - مفتاح **"الأسعار شاملة الضريبة"**، وده الشائع في مصر.
>    - مفتاح **"احسب ضريبة على الشحن"**.
>    - **نسبة لكل دولة**، مثلاً مصر 14%، ونسبة مختلفة لمحافظة معيّنة لو حبيت.
>    - المنتج اللي مكتوب عليه "لا يخضع للضريبة" ما بيتحسبش عليه.
>    - لو ما حطّيتش أي نسبة، **الضريبة صفر** (مش 10% زي دلوقتي).
> 4. **حجز البضاعة لحظة الطلب**: أول ما العميل يدوس "إتمام الطلب"، الكمية بتتحجز.
>    - لو اتنين طلبوا آخر قطعة في نفس اللحظة، واحد بس اللي هياخدها، والتاني يشوف "الكمية خلصت".
>    - لو الطلب اتلغى، البضاعة بترجع.
>
> وكمان: لينك "المتجر" في لوحة التحكم بقى بيروح على متجرك (مش localhost)، وعنوان التاب في المتجر بقى اسم متجرك.
>
> **فيه migration واحدة** (جداول الإعدادات والشحن والضرايب، وعمود المحافظة في عنوان الطلب). هتطبّقها لما Sonnet يقولك.
>
> **بعد النشر لازم تعمل منطقة شحن واحدة على الأقل**، وإلا صفحة الدفع هتقول "مفيش شحن لعنوانك".

**Goal:** Replace the three production stubs (fixed currency guesses, a fixed 5/15 shipping quote, a flat 10% tax) with Shopify's real models, and reserve stock when the order is placed.

**Architecture (Shopify's models, adopted as-is):**

- **Store settings** (Shopify: Settings → General). One row per shop in `tenancy.store_settings`:
  - `store_name`, `contact_email`;
  - `currency` (ISO 4217);
  - `timezone` (IANA);
  - `weight_unit` (`kg` | `g` | `lb` | `oz`).
  - Owned by the Tenancy service: a `StoreSettings` aggregate, plus `GET` / `PUT /store/settings`, and a public `GET /public/store` that returns only name and currency.
- **Store currency.**
  - **Every price is in the store currency.** The product editor, cart, checkout, shipping rates and tax amounts all use it.
  - **Changing it relabels.** It does not convert: `UPDATE` every variant's currency, keeping the amounts. That is Shopify's behavior.
  - **Orders keep their own currency.**
  - **Carts:** a cart in another currency is replaced by a fresh cart on the next add.
- **Shipping** (Shopify: Shipping and delivery → General shipping rates). Owned by the Shipping service.
  - **`ShippingZone`:**
    - `name`;
    - `profile` (`"general"` for now; custom profiles come later, and the column exists now so nothing is reshaped then);
    - `countries`: `[{ code, provinces: string[] | null }]`, where `null` means the whole country;
    - and its `ShippingRate`s.
  - **`ShippingRate`:**
    - `name` (what the shopper sees);
    - `priceMinor`, in the store currency;
    - `condition`: `none` | `orderPrice {min?, max?}` | `weight {minGrams?, maxGrams?}`;
    - an optional `description` (e.g. "2–4 business days").
  - **Quoting** (a pure function, Shopify's rules):
    1. Pick the zone that matches the address. A zone listing the address's province beats one listing the whole country, which beats a "rest of world" zone (`countries: [{ code: "*" }]`).
    2. Return that zone's rates whose condition matches. The order price is the subtotal of the lines; the weight is the sum of `weightGrams × qty` over lines that require shipping.
    3. **No matching zone or rate** means no rates. The checkout says shipping is not available to this address.
    4. **No line requires shipping** means one implicit rate, `"none"` (name "No shipping required", price 0).
- **Taxes** (Shopify: Taxes and duties). Owned by the Finance service, in **new** tables. Do not repurpose `TaxProfile`, which serves finance reporting.
  - `TaxSettings`: `pricesIncludeTax` (default **true**) and `chargeTaxOnShipping` (default false).
  - `TaxRegion`s: `{ countryCode, rateBasisPoints, provinces: [{ code, rateBasisPoints }] }`. A province rate **replaces** the country rate. Shopify's "added to" / "compounded" province modes are a recorded gap.
  - **Calculation** (pure):
    - Per taxable line (`variant.taxable`), plus shipping when `chargeTaxOnShipping`, using the destination's rate.
    - **Inclusive:** `tax = round(amount × r / (1 + r))`, already inside the prices, not added to the total.
    - **Exclusive:** `tax = round(amount × r)`, added to the total.
    - Half-up rounding on minor units, per line.
    - **No region** for the destination means 0.
- **Address province.**
  - `CheckoutAddress` and Orders' `AddressSnapshot` gain an optional `province` (an ISO 3166-2 code such as `EG-C`). It goes in the checkout's JSON column, plus a new column on `orders.order_shipping_addresses`.
  - The checkout shows a **province select** for countries with province data.
  - **Data:** EG (27 governorates), SA (13 regions) and AE (7 emirates), each with en and ar names. Other countries are country-level only.
- **Reservation at order placement** (Shopify "committed").
  - After `CompleteCheckout` creates the order, it reserves every stock-limited line at the location `pickLocation` chooses (Plan 2B-3), with reference = the order id. This uses the existing `OrdersInventoryAdapter` reserve path through a new optional checkout port.
  - **If any line cannot be reserved** (a race lost after validation): release what was reserved, cancel the order (the Plan 3B cancel, with its cleanup), and return `409 OUT_OF_STOCK:`. The shopper sees the existing message.
  - **Later "Request fulfillment"** finds the existing reservation by order reference (the drift-safe check from 2B-3) and does not reserve twice.
  - **Cancel** already releases by order reference (G-130).
  - **Committing a reservation when the order ships** stays a recorded gap, tied to the fulfillment rework (G-131).
- **Checkout ports become real.**
  - `ShippingCalculationPort.quote(address{country, province, postalCode}, lines, currency, tenantId)` returns `{ method: rateId, name, rateAmountMinor, description? }[]`.
  - `TaxCalculationPort.calculate(lines, address{country, province}, shippingMinor, currency, tenantId)` returns `{ taxMinor, included: boolean }`.
  - **Lines** carry `variantId`, `quantity`, `unitPriceMinor`, `taxable`, `requiresShipping` and `weightGrams`. The **adapters** in `apps/admin` resolve them from Catalog (never trust the session for these).
  - **The in-memory stubs stay** for tests and local runs. Production composition passes the real adapters, and the boot guard that refused stubs in production keeps refusing.
- **Totals.**
  - `CheckoutTotals` and the order totals JSON gain `taxIncluded: boolean` and the shipping rate `name`.
  - `grandTotal = subtotal + shipping − discount + (taxIncluded ? 0 : tax)`.
  - The storefront summary shows "Including {tax} in taxes" when included, or a "Taxes" line otherwise.

**Tech Stack:** TypeScript, Prisma 6 (no upgrade), zod, vitest, Next.js 15, React 19, `@platform/ui`.

**Spec:**

- Owner: "جهز حجز البضاعه والشحن والضرايب والعملة … زي شوبيفاي من الاول علشان منعملش حاجه ونرجع نغيرها".
- Gaps:
  - G-99 (store currency);
  - G-114 (reservation at placement);
  - the shipping stub gap and the tax stub gap from Plan 3A (G-118 / G-120; verify the numbers);
  - G-119 (fixed country list).
- Admin `navigation.ts:136` falls back to `http://localhost:3000`; storefront `layout.tsx:13` title "Platform — foundation".

## Global Constraints

Same as Plans 3A/3B. Every task implicitly includes these.

### Git and branch

- Branch `morbeh/w0-w17-w12`. No force-push. No `--no-verify`. **Never touch the lint warning cap.**
- Never stage `.claude/worktrees/`.
- Commit lines at most 100 characters, lowercase subject.
- End every commit with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Check `git diff --cached --stat` before every commit. Run prettier only on files you changed.
- Never use `git stash`, `git add -A`, `git add .` or `git add -N`.

### Database

- **Never connect to any database.**
- **Never set `TENANT_MODE=multi`.**
- **No guard exemptions.** No new `TENANT_DEFAULT_ID` reads.
- **Do not upgrade Prisma.**
- **Push order:**
  - Task 1 (SQL only) is pushed alone.
  - Everything else stays local until the owner confirms the migration (the final task).

### Security

- Security assertions from Plans 2A, 2C-1, 2B-1, 2B-3, 3A and 3B stay green and unchanged.
- **The storefront never sends a price, rate, tax or amount.** Shipping and tax are computed server-side from server data.
- `GET /public/store` returns name and currency only.
- Zone, rate and tax admin routes need staff permissions. Add `settings:read` / `settings:update`, or reuse the closest existing ones. Name them in the report.

### App rules

- Runtime API calls only from server code. One idempotency key per write. `toFormState` for every non-`ok` outcome.
- Both message files get every key, in admin-web and storefront. Logical RTL classes only.
- No `autoFocus`. No async function without `await`.
- **Save buttons** follow the product page rule: off until the form differs from what was saved.
- **Money inputs:** use the admin `MoneyInput` and `toMinorUnits` (exponent-aware). **Weight inputs:** in the store's weight unit, stored as grams.

### Commands

- Per-package `pnpm.cmd --filter <pkg> run test|typecheck|lint`, sequentially.
- No new warnings in touched files.

---

### Task 1: Migration (pushed alone)

**File:** `packages/db/prisma/schema/migrations/20261013000000_store_shipping_taxes/migration.sql`

Every new table:

- gets `ENABLE` + `FORCE ROW LEVEL SECURITY` and a `tenant_isolation` policy, exactly as in `20260923000000_wp13_merchant_payments`;
- gets the same grants that migration gives, if any.

```sql
-- Plan 3C — store settings, shipping zones and rates, taxes, and the address province. Written by
-- hand, NOT applied by the agent; the owner deploys it from Railway's Console BEFORE the release
-- that reads these tables.
SET row_security = off;

CREATE TABLE "tenancy"."store_settings" (
  "tenant_id"     TEXT NOT NULL,
  "store_name"    TEXT NOT NULL DEFAULT '',
  "contact_email" TEXT,
  "currency"      CHAR(3) NOT NULL DEFAULT 'EGP',
  "timezone"      TEXT NOT NULL DEFAULT 'Africa/Cairo',
  "weight_unit"   TEXT NOT NULL DEFAULT 'kg',
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_settings_pkey" PRIMARY KEY ("tenant_id")
);
-- (RLS + policy + grants)

-- One row per shop that has products: its most used variant currency (the store currency until
-- now was only implied by its products).
INSERT INTO "tenancy"."store_settings" ("tenant_id", "currency")
SELECT DISTINCT ON ("tenant_id") "tenant_id", "currency"
FROM (
  SELECT "tenant_id", "currency", COUNT(*) AS n
  FROM "catalog"."product_variants" GROUP BY "tenant_id", "currency"
) AS c
ORDER BY "tenant_id", n DESC
ON CONFLICT ("tenant_id") DO NOTHING;

CREATE TABLE "shipping"."shipping_zones" (
  "id"         UUID NOT NULL,
  "tenant_id"  TEXT NOT NULL,
  "profile"    TEXT NOT NULL DEFAULT 'general',
  "name"       TEXT NOT NULL,
  "countries"  JSONB NOT NULL DEFAULT '[]',
  "position"   INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shipping_zones_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "shipping_zones_tenant_id_profile_idx" ON "shipping"."shipping_zones" ("tenant_id", "profile");

CREATE TABLE "shipping"."shipping_rates" (
  "id"             UUID NOT NULL,
  "tenant_id"      TEXT NOT NULL,
  "zone_id"        UUID NOT NULL,
  "name"           TEXT NOT NULL,
  "price_minor"    INTEGER NOT NULL,
  "condition_type" TEXT NOT NULL DEFAULT 'none',
  "condition_min"  BIGINT,
  "condition_max"  BIGINT,
  "description"    TEXT,
  "position"       INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "shipping_rates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shipping_rates_zone_id_fkey" FOREIGN KEY ("zone_id")
    REFERENCES "shipping"."shipping_zones" ("id") ON DELETE CASCADE
);
CREATE INDEX "shipping_rates_tenant_id_zone_id_idx" ON "shipping"."shipping_rates" ("tenant_id", "zone_id");

CREATE TABLE "finance"."tax_settings" (
  "tenant_id"              TEXT NOT NULL,
  "prices_include_tax"     BOOLEAN NOT NULL DEFAULT true,
  "charge_tax_on_shipping" BOOLEAN NOT NULL DEFAULT false,
  "updated_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_settings_pkey" PRIMARY KEY ("tenant_id")
);

CREATE TABLE "finance"."tax_regions" (
  "id"                UUID NOT NULL,
  "tenant_id"         TEXT NOT NULL,
  "country_code"      CHAR(2) NOT NULL,
  "rate_basis_points" INTEGER NOT NULL,
  "provinces"         JSONB NOT NULL DEFAULT '[]',
  CONSTRAINT "tax_regions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_regions_tenant_id_country_code_key" UNIQUE ("tenant_id", "country_code")
);

ALTER TABLE "orders"."order_shipping_addresses" ADD COLUMN "province" TEXT;

RESET row_security;
```

**Before writing it, check three things:**

- **Schemas:** that `shipping` and `finance` exist in the datasource list. Both are in the owner's Console output.
- **`product_variants`:** its table and column names. Use the real ones.
- **The CHECK style:** whether the repo prefers `CHECK` constraints. If so, add `condition_type IN ('none','order_price','weight')` and `weight_unit IN ('kg','g','lb','oz')`.

Update the consistency test only if it requires it. If it forces the Prisma models into this commit, include them (nothing reads them yet), and say so.

Run the db tests. Commit and push **alone**:

```bash
git commit -m "feat(db): add store settings, shipping zones and rates, tax tables, address province"
git push origin morbeh/w0-w17-w12
```

Print for the owner, in Arabic, and continue:

> لما Railway يخلّص النشر (حوالي 5 دقايق)، طبّق من runtime-api → Console:
> `cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`
> المفروض تشوف `20261013000000_store_shipping_taxes`. ابعتلي الناتج.

---

### Task 2: Region data (pure, shared)

**File:** a new `packages/regions` (or the closest existing shared package; name it in the report). It exports:

- `COUNTRY_CODES`: all ISO 3166-1 alpha-2 codes. Names come from `Intl.DisplayNames` at render time; the package has no name table for countries.
- `PROVINCES`: `Record<countryCode, { code, en, ar }[]>` for EG, SA and AE, using these ISO 3166-2 codes:
  - **EG:**
    - `EG-ALX` Alexandria / الإسكندرية, `EG-ASN` Aswan / أسوان, `EG-AST` Asyut / أسيوط, `EG-BA` Red Sea / البحر الأحمر, `EG-BH` Beheira / البحيرة, `EG-BNS` Beni Suef / بني سويف, `EG-C` Cairo / القاهرة,
    - `EG-DK` Dakahlia / الدقهلية, `EG-DT` Damietta / دمياط, `EG-FYM` Faiyum / الفيوم, `EG-GH` Gharbia / الغربية, `EG-GZ` Giza / الجيزة, `EG-IS` Ismailia / الإسماعيلية, `EG-JS` South Sinai / جنوب سيناء,
    - `EG-KB` Qalyubia / القليوبية, `EG-KFS` Kafr El Sheikh / كفر الشيخ, `EG-KN` Qena / قنا, `EG-LX` Luxor / الأقصر, `EG-MN` Minya / المنيا, `EG-MNF` Monufia / المنوفية, `EG-MT` Matrouh / مطروح,
    - `EG-PTS` Port Said / بورسعيد, `EG-SHG` Sohag / سوهاج, `EG-SHR` Sharqia / الشرقية, `EG-SIN` North Sinai / شمال سيناء, `EG-SUZ` Suez / السويس, `EG-WAD` New Valley / الوادي الجديد.
  - **SA:** the 13 regions (`SA-01` Riyadh … `SA-14` Asir); use the official ISO list.
  - **AE:** `AE-AZ`, `AE-AJ`, `AE-FU`, `AE-SH`, `AE-DU`, `AE-RK`, `AE-UQ`.
- `provinceName(code, locale)` and `hasProvinces(countryCode)`.

**Tests:**

- EG has 27 entries with unique codes.
- Every entry has en and ar names.
- `provinceName("EG-C", "ar")` returns `"القاهرة"`.

Commit: `feat(regions): country codes and provinces for egypt, saudi arabia and the emirates`.

---

### Task 3: Store settings and store currency

**Files:**

- **Tenancy:**
  - the `StoreSettings` aggregate, which validates:
    - `currency` against an ISO 4217 list (embed the common list; reject anything else);
    - `timezone` via `Intl.supportedValuesOf("timeZone")` when available, else a non-empty `Area/City`;
    - `weight_unit` in the four values;
    - `contact_email`, when present;
    - `store_name` at most 120 characters;
  - `GetStoreSettings` (returns defaults when there is no row: name `""`, EGP, Africa/Cairo, kg) and `UpdateStoreSettings`;
  - the Prisma repository and the controller.
- **`apps/admin`:**
  - routes `GET` / `PUT /store/settings` (staff) and `GET /public/store` (public: `{ name, currency }`);
  - the currency-change cross-context step: when `currency` changes, call a new Catalog use case `RelabelVariantCurrency(tenantId, currency)`. It updates every variant's currency, **keeping amounts**, and has its own test. Settings are saved first; a relabel failure returns 500, and a retry is safe because the relabel is idempotent.
- **`admin-web`:**
  - Settings → **General** (`/settings/general`), with fields:
    - Store name and Store contact email;
    - **Store currency** (a select of the embedded list, showing code and name via `Intl.DisplayNames(…, {type:"currency"})`);
    - Time zone (a select);
    - Weight unit.
  - **Changing the currency shows a confirm:** "Product prices keep their numbers and switch to {code}. Existing orders keep their currency." / "أسعار المنتجات هتفضل بنفس الأرقام وهتبقى بـ {code}. الطلبات القديمة هتفضل بعملتها."
  - **Link it** from the Settings page.
- **Use the store currency** in the product editor default (`products/new` and `[productId]`), replacing the guesses at `products/new/page.tsx:33-36` and `[productId]/page.tsx:154`.
- **Show weights** in the store's weight unit in the product editor's weight field (`toGrams` / `fromGrams` helpers with tests). Storage stays grams.
- **Storefront:**
  - cart actions create carts in the store currency (`GET /public/store`), replacing the product-currency inference;
  - an existing cart in another currency is replaced on the next add (drop the cookie and create a new cart);
  - **`layout.tsx`:** the title from `GET /public/store` (`generateMetadata`), as `{store name}`, or `"Store"` when empty.
- **Admin `navigation.ts`:** the storefront link uses the runtime `STOREFRONT_URL` (as the product Preview button does), and hides the link when unset. **No localhost fallback.**

**Tests:**

- The aggregate's validation, and the defaults.
- The relabel use case keeps the amounts.
- The route permissions, and that the public route is name and currency only.
- The admin form: Save stays off until a change; the currency confirm.
- The storefront cart currency switch.
- The navigation link.

Commit: `feat(store): general settings with a store currency, like shopify`.

---

### Task 4: Shipping zones and rates

**Files:**

- **Shipping service:**
  - `ShippingZone` (aggregate root, owning its rates) and the `ShippingRate` entity;
  - the repository (Prisma + in-memory), and use cases `ListZones`, `CreateZone`, `UpdateZone` (name and countries), `DeleteZone`, `AddRate`, `UpdateRate` and `DeleteRate`;
  - the pure `quoteRates(zones, address, lines)` implementing the Architecture rules.
- **`apps/admin`:** staff routes under `/shipping/zones…`.

**Validation:**

- **Zone:**
  - the name is 1–80 characters;
  - every country code is in `COUNTRY_CODES` or `"*"`;
  - every province is in that country's list;
  - **no country (or province) may appear in two zones of the same profile.** Shopify refuses this too: "A country can only be in one zone". Return a field error naming the zone.
- **Rate:**
  - the name is 1–80 characters;
  - `priceMinor ≥ 0`;
  - `min ≤ max` when both are set;
  - `orderPrice` bounds are in minor units, `weight` bounds in grams.

**`quoteRates` tests:**

- province beats country beats `*`;
- no zone gives `[]`;
- `orderPrice` min and max are inclusive at the min and exclusive at the max, as in Shopify;
- weight ignores lines that do not require shipping;
- all lines not requiring shipping give the single `"none"` rate;
- rates are sorted by price, then position.

**Admin-web:** Settings → **Shipping and delivery** (`/settings/shipping`), mirroring Shopify.

- **A "General shipping rates" card,** listing zones. Each zone shows:
  - its name;
  - the countries, summarized: "Egypt (5 of 27 governorates)", "Saudi Arabia", "Rest of world";
  - its rates in a table: Name, Condition ("—", "EGP 1,000.00 and up", "0–5 kg"), Price ("Free" when 0);
  - per-rate Edit and Delete;
  - "Add rate";
  - zone Edit and Delete (with a confirm).
- **"Create zone" opens a dialog** with:
  - Zone name;
  - a searchable country list with checkboxes;
  - for a country with provinces, an expand control listing them with checkboxes. Checking the country checks all of them, which means `provinces: null`.
  - **Countries already in another zone** are shown disabled with "In {zone}".
  - "Rest of world" as its own checkbox.
- **The rate dialog** has:
  - Rate name (the hint: "Customers see this at checkout") and an optional Description ("e.g. 2–4 business days");
  - Price (`MoneyInput`, store currency), plus a "Free" shortcut that sets 0;
  - "Add conditions": radio Based on item weight / Based on order price, with Minimum and Maximum. Weight uses the store unit; price uses `MoneyInput`.
- **Empty state:** "You don't ship anywhere yet. Create a shipping zone so customers can check out." / "لسه مفيش مناطق شحن. اعمل منطقة شحن عشان العملاء يقدروا يطلبوا."

**Tests:** the aggregate rules (incl. no duplicate country/province), the use cases, the routes (permissions, tenant isolation), and the admin dialogs (country/province checking, the conditions).

Commit: `feat(shipping): shipping zones and rates like shopify`.

---

### Task 5: Taxes

**Files:**

- **Finance service:**
  - the `TaxSettings` aggregate (settings plus its regions);
  - use cases `GetTaxSettings` (defaults: inclusive, no shipping tax, no regions), `UpdateTaxSettings` (the two flags), `UpsertTaxRegion`, `DeleteTaxRegion`;
  - the Prisma and in-memory repositories;
  - the pure `calculateTax(settings, lines, address, shippingMinor)` from the Architecture.
- **`apps/admin`:** staff routes under `/taxes…`.

**Validation:**

- `rateBasisPoints` is an integer from 0 to 10000 (0–100%), entered in the UI as a percent with up to 3 decimals.
- Province codes belong to the country.
- One region per country.

**`calculateTax` tests:**

- **Inclusive:** EGP 114.00 at 14% gives tax 14.00, included.
- **Exclusive:** 100.00 at 14% gives 14.00, added.
- **Province override:** EG-C at 10% while EG is 14%.
- **The other cases:**
  - a non-taxable line is excluded;
  - shipping is taxed only with the flag;
  - no region gives 0;
  - rounding is per line, half-up.

**Admin-web:** Settings → **Taxes and duties** (`/settings/taxes`).

- **Two switches:**
  - "All prices include tax" / "كل الأسعار شاملة الضريبة", with Shopify's hint;
  - "Charge tax on shipping rates" / "احسب ضريبة على أسعار الشحن".
- **A "Regions" table:** Country, Rate, and "{n} province overrides".
  - "Add region": country select plus rate %.
  - Each row has Edit, which opens a dialog with the country rate and a province override table, for countries with provinces.
  - Each row has Delete.
- **Empty state:** "You're not collecting tax anywhere. Add a region to charge tax." / "إنت مش بتحصّل ضريبة في أي مكان. ضيف دولة عشان تحسب ضريبة."

Commit: `feat(finance): tax settings and regions like shopify`.

---

### Task 6: Real shipping and tax in checkout, with the province

**Files:**

- **Checkout:**
  - `CheckoutAddress.province?`, validated against the region data when the country has provinces, and required for those countries;
  - the port signatures from the Architecture;
  - `SelectShipping` re-quotes server-side and matches by rate id (it already re-quotes; keep that), snapshotting the `name`;
  - totals: `taxIncluded`, `shippingName`, and the `grandTotal` formula;
  - the in-memory stubs updated to the new signatures (the stub tax returns 0 included, so local runs no longer add 10%).
- **`apps/admin` adapters:**
  - `ShippingQuoteAdapter` (Shipping's `quoteRates` over the tenant's zones and Catalog-resolved lines);
  - `TaxCalculationAdapter` (Finance's `calculateTax` and settings);
  - production composition passes them.
  - **Check the runtime boot guard** for stub ports: the shipping and tax stubs must now be refused in production, as the others are. If the guard lists ports, add these two.
- **Orders:**
  - `AddressSnapshot.province`, and the column mapping (it reads the new column);
  - the totals JSON `taxIncluded` and `shippingName`;
  - the admin order page shows the province name, "Including {tax} in taxes" when included, and the shipping name.
- **Public checkout routes:** `addressBody.province` (optional, at most 10 characters), and the DTO echoes it.
- **Storefront checkout** (Plan 3A's one-page form):
  - **Country select:** the union of the countries in the tenant's zones (a new public `GET /public/shipping/countries` returning `{ countries: string[] , restOfWorld: boolean }`). With `restOfWorld`, show all `COUNTRY_CODES`. With none, show the "not shipping anywhere yet" message and disable submit.
  - **Province select** ("Governorate" / "المحافظة" for EG, "Region" / "المنطقة" for SA, "Emirate" / "الإمارة" for AE), required, from the region data. The address is complete only with it.
  - **Shipping methods:** the rate `name`, an optional `description` muted, and the price, with "Free" / "مجاني" for 0.
  - **No rates:** "Shipping isn't available for this address." / "الشحن مش متاح للعنوان ده." Submit is disabled.
  - **Summary:**
    - inclusive: "Including {tax} in taxes" / "شامل {tax} ضرايب" under Total;
    - exclusive: a "Taxes" line;
    - zero tax: nothing.
  - **Remove the fixed 20-country list** from Plan 3A.

**Tests:**

- **Ports and adapters:** they resolve lines from Catalog, never from the session.
- **Checkout e2e** (admin), covering:
  - an EG-C zone at 50.00 and the rest of EG at 75.00;
  - a Cairo address quotes 50, and a Giza address quotes 75;
  - "free over 1000" appears only above the threshold;
  - inclusive 14% gives a grand total = subtotal + shipping, with `taxMinor` > 0 and `taxIncluded`;
  - exclusive gives a grand total that includes the tax;
  - an address outside every zone gives no rates, and selecting a forged method id gives a 422.
- **The storefront form:** the country list from zones, the province required, the no-rates message, and the tax lines.

Commit: `feat(checkout): real shipping zones and taxes with the governorate, like shopify`.

---

### Task 7: Reserve stock when the order is placed (closes G-114)

**Files:**

- `services/checkout`:
  - an optional `OrderStockReservationPort` (`reserve(orderId, lines, tenantId)` → `{ ok: true } | { ok: false, reason }`; `release(orderId, tenantId)`);
  - in `CompleteCheckout`, after `orderCreation.create`, call `reserve`. On `ok: false`: `release`, cancel the order through a new optional `orderCancellation` port, mark the session **not** completed (or keep it completable; read the session's state rules and pick the one that lets the shopper go back to the cart; report the choice), and return `BusinessRuleError("OUT_OF_STOCK: …")`.
- `apps/admin`: an adapter over the existing `OrdersInventoryAdapter` reserve logic (`pickLocation`, the `continue` rule, reference = order id), and the cancel adapter over the Plan 3B cancel use case. Composition passes both.

**Rules:**

- Untracked and `continue` lines reserve what is available (the existing rule), and never fail the order.
- `RequestFulfillment` later reuses the existing reservation (no double reserve). **Prove it with a test.**
- The validation gate from 2B-3 stays; reservation is the second, race-proof check.

**Tests:**

- Placing an order reserves (available drops, reserved rises).
- **The lost race:** validation passes, reservation fails, the order is cancelled, the stock is unchanged, and the result is 409 `OUT_OF_STOCK:`.
- Cancelling the order releases (G-130 path).
- Request fulfillment does not reserve twice.

Commit: `feat(checkout): reserve stock when the order is placed, like shopify`.

---

### Task 8: Docs, gaps, gates, STOP

**Close:**

- G-99 (store currency);
- G-114 (reservation at placement);
- the shipping-stub gap;
- the tax-stub gap;
- the fixed-country-list gap.

Use the real numbers, and reference the tests.

**Open:**

- **Medium:** "Committing a reservation when the order ships (on-hand decreases) waits for the fulfillment rework (G-131)."
- **Low:**
  - "Tax province modes 'added to' / 'compounded' (Shopify Canada-style) are not supported; a province rate replaces the country rate."
  - "Custom shipping profiles (per-product rates), local delivery and pickup are not built; every product uses the general profile."
  - "Province data exists for EG, SA and AE only."
  - "Changing the store currency relabels prices; it does not convert them (same as Shopify)."

**Gates, sequentially:**

1. the package suites (tenancy, shipping, finance, catalog, checkout, orders, inventory, payments, admin, storefront, admin-web, db, regions);
2. `pnpm.cmd -r --no-bail run typecheck`;
3. `pnpm.cmd -r --no-bail run lint`, with no new warnings in touched files;
4. `pnpm.cmd arch`, with `tenant-mode-guard` and `prisma-tenant-where.guard` passing.

Commit the docs, including this plan file: `docs(store): record plan 3c, close the currency, shipping, tax and reservation gaps`.

**STOP.** Give the Arabic report. Ask the owner to confirm `20261013000000_store_shipping_taxes` was applied. Push only after they confirm.

## Done criteria

- The store has a currency setting. Prices, carts, checkout, shipping and tax use it.
- The merchant manages shipping zones (with governorates) and rates (flat, by price, by weight, free), and the checkout quotes them.
- The merchant manages tax (inclusive or exclusive, per country and province). With no regions, tax is 0.
- An order reserves its stock when placed. A lost race cancels cleanly with "out of stock".
- The admin store link and the storefront title are correct.
- Every gate is green. The security assertions are unchanged.

## Arabic report (for the owner)

- The commits and test counts.
- **Setup steps after the push** (in this order, with exact menu names):
  1. **الإعدادات ← عام:** اسم المتجر، والعملة "EGP"، واحفظ.
  2. **الإعدادات ← الشحن والتوصيل:** "إنشاء منطقة" باسم "القاهرة والجيزة"، فيها مصر ← القاهرة + الجيزة، وسعر "شحن عادي" 50. ومنطقة تانية "باقي المحافظات" بسعر 75، وسعر "شحن مجاني" 0 بشرط "قيمة الطلب من 1000".
  3. **الإعدادات ← الضرايب:** سيب "الأسعار شاملة الضريبة" شغال. لو بتحصّل ضريبة، ضيف مصر 14%؛ لو لأ، سيبها فاضية.
- **How to try it:** a Cairo address shows 50, a Giza address shows 75, and an order over 1000 shows free shipping. The total says "شامل … ضرايب". The order reserves stock: the product's quantity drops when ordered and comes back on cancel.
- Every decision not in the plan.
