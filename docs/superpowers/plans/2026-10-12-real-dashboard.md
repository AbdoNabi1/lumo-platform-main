# Real Dashboard and Analytics (Plan 3D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **ملخص للمالك (بالعربي):** الداشبورد دلوقتي بيعرض **أرقام تجريبية** (128,340$ و1,482 طلب…)، ومكتوب جنبها "Demo". الخطة دي بتخليه زي **الصفحة الرئيسية في شوبيفاي**: **أرقام حقيقية من طلباتك، ولو صفر يبان صفر.**
>
> - **4 كروت:** إجمالي المبيعات، وعدد الطلبات، ومتوسط قيمة الطلب، و**طلبات محتاجة تجهيز**. كل كرت فيه المقارنة بالفترة اللي قبلها (مثلاً ↑ 12%).
>   - كرت "معدل التحويل" بيتشال، لأنه محتاج عدد زوار المتجر واحنا لسه مش بنعدّهم. **مش هنعرض رقم مش حقيقي.**
> - **رسم المبيعات** بالأيام، حسب المنطقة الزمنية بتاعة متجرك.
> - **أكتر المنتجات مبيعًا** في الفترة.
> - **آخر الطلبات** بنفس شكل قايمة الطلبات الجديدة: الاسم، والحالتين.
> - **اختيار الفترة:** النهارده، امبارح، آخر 7 أيام، آخر 30 يوم، الشهر ده.
> - **الطلبات اللي "مفيش عميل"** في القايمة هيظهر لها اسم العميل أو إيميله.
> - **أي صفحة تانية في لوحة التحكم فيها أرقام تجريبية** يا هتبقى حقيقية، يا هتتشال، يا هتقول "لسه مفيش بيانات".
>
> مفيش migration.

**Goal:** Every number in the admin is real. The Home dashboard matches Shopify's Home (real sales, orders, AOV, orders to fulfill, a sales chart, top products and recent orders), computed from Postgres with a date range and a comparison. No demo data remains anywhere in the admin.

**Architecture:**

- **One read model in `services/orders`:** `GetSalesSummary({ tenantId, from, to, timezone, currency })` over `orders.orders`, `orders.order_items` and `orders.order_events`. It runs SQL aggregates via Prisma `$queryRaw`, tenant-scoped (RLS plus an explicit `tenant_id`), and returns:
  - **`totalSalesMinor`:** the sum of `totals.totalMinor` over **counted orders**, i.e. orders created in `[from, to)`, in `currency`, and never cancelled. Fully refunded orders count as **0**. That is Shopify's "total sales" net of returns, simplified to full refunds; partial refunds are G-132.
  - **`ordersCount`:** the number of counted orders, refunded ones included (Shopify counts the order).
  - **`averageOrderValueMinor`:** `totalSalesMinor / ordersCount`, rounded half-up, or 0.
  - **`ordersToFulfill`:** **all-time** (not range-bound) orders that are not cancelled and not closed, with `fulfillmentStatus = unfulfilled`, using the Plan 3B derivation (the same function; no second definition).
  - **`daily[]`:** `{ date: "YYYY-MM-DD", salesMinor, orders }` for **every** day in the range, including zero days. Days are bucketed by `created_at AT TIME ZONE timezone`.
  - **`topProducts[]`:** the top 5 by quantity over counted, non-refunded orders: `{ productRef, variantRef, name, variantTitle, quantity, salesMinor }`.
  - **`otherCurrencyOrders`:** the number of orders in the range in a currency other than `currency`. They are excluded from the sums, and the UI says so.
- **The comparison** is the same call for the previous equal-length range. The admin computes `% change`. When the previous value is 0: `—` if both are 0, and "New" if only the current is non-zero.
- **The route:** `GET /analytics/sales?from&to` (staff, `orders:read`). The handler reads the store timezone and currency from Store settings (Plan 3C) and calls the read model twice (current and previous). One response: `{ current, previous, currency, timezone }`. Add the Plan 2C-3 `featuredImage` to top products when the media read exists, through the batched lookup.
- **The orders list `customerName` fallback:** when `recipientName` is null, use the Identity customer's name, else their email, in **one batched** lookup per page. This also feeds Recent orders.
- **The admin dashboard** (`app/page.tsx` and `components/dashboard/*`) renders only this data. **Delete** `data/dashboard.ts`, `data/recent-orders.ts` and every "Demo" badge, banner and sample number.

**Tech Stack:** TypeScript, Prisma 6 (no upgrade), vitest, Next.js 15, React 19, `@platform/ui`.

**Spec:**

- Owner screenshot, 2026-10-12: the Dashboard with "Demo" KPIs ($128,340.00, 1,482 orders, 2.34% conversion), the "Reporting unavailable" banner, and Recent orders showing "Customer 149F27" and old statuses.
- Owner: "مش مفترض الداشبورد تعرض الارقام الحقيقية حتي لو صفر تعرض صفر".
- Master plan, Phase 1 item 14: Home figures are computed from Postgres directly.

## Global Constraints

Same as Plans 3A–3C. Every task implicitly includes these.

### Git and branch

- Branch `morbeh/w0-w17-w12`. No force-push. No `--no-verify`. **Never touch the lint warning cap.**
- Never stage `.claude/worktrees/`.
- Never use `git stash`, `git add -A`, `git add .` or `git add -N`.
- Commit lines at most 100 characters, lowercase subject.
- End every commit with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Check `git diff --cached --stat` before every commit. Run prettier only on files you changed.

### Database

- **No migration.** If one seems needed, STOP and ask.
- **Never connect to any database.**
- **Never set `TENANT_MODE=multi`.**
- **No guard exemptions:** raw SQL must carry `tenant_id` and pass `prisma-tenant-where.guard` as written.
- **Do not upgrade Prisma.**

### Security

- Security assertions from all earlier plans stay unchanged.
- Analytics is staff-only and tenant-scoped. A cross-tenant test proves another shop's orders never count.

### App rules

- Runtime API calls only from server code.
- Both message files get every key. Logical RTL classes only.
- **Money:** `formatCurrency`. **Dates:** in the store timezone.
- **An unreachable API** shows an error state with "Try again", **never** sample numbers.
- **No async function without `await`.** No new warnings in touched files.

### Commands

Per-package `pnpm.cmd --filter <pkg> run test|typecheck|lint`, sequentially.

**Ordering:** if Plan 2C-3 (images) is still unpushed on this branch, finish and push it first. Then start this plan from its tip.

---

### Task 1: Demo-data inventory (no code changes)

Search admin-web for:

- demo or sample data: `data/` imports, "Demo" badges, `sample`, hard-coded KPI numbers, fake series, and placeholder customers;
- banners that excuse missing backends.

Write a table into the plan file under "Inventory", with one row per page or component:

| Page/component | What is fake | Real source available? | Action |
| -------------- | ------------ | ---------------------- | ------ |

**Actions:**

- **`real`:** the source exists and this plan wires it.
- **`remove`:** no honest source exists, so remove the element (for example, conversion rate, sessions, sales by channel).
- **`empty`:** the page keeps its purpose but shows a real empty state ("No data yet" / "لسه مفيش بيانات") instead of samples.

The Home page rows are all `real` or `remove`. For other pages, prefer `real` when this plan's read model covers it (Analytics: sales, orders, AOV, top products), otherwise `remove` / `empty`.

Commit the plan file update: `docs(analytics): inventory every demo number in the admin`.

---

### Task 2: Sales summary read model and route

**Files:**

- `services/orders`:
  - the `GetSalesSummary` use case;
  - a `SalesSummaryQuery` port;
  - the Prisma implementation (`$queryRaw`) and an in-memory implementation (over the in-memory order repository, the same semantics);
  - a controller method.
- `apps/admin`: the `GET /analytics/sales` route (`from` and `to` as ISO dates in the store timezone; the range is at most 366 days; `from < to`). The handler loads the store settings and calls the read model for the current and previous ranges.

**Tests (against the in-memory implementation, plus SQL-shape tests for Prisma, as in Plan 3B):**

- Zero orders give zeros, and `daily` lists every day with 0.
- Cancelled orders are excluded.
- A refunded order counts in orders but adds 0 sales.
- Another currency is excluded and counted in `otherCurrencyOrders`.
- **Timezone bucketing:** an order at 23:30 UTC on Oct 9 lands on Oct 10 in Africa/Cairo (UTC+3 in the summer of 2026; use a fixed offset in the test or a zone without DST).
- **Top products:** ordering, ties broken by sales then name, and refunded orders excluded.
- `ordersToFulfill` uses the 3B derivation, all-time.
- **Route:** a 400 for a bad range, a 403 without the permission, and the cross-tenant check.

Commit: `feat(orders): real sales summary for the dashboard, computed from orders`.

---

### Task 3: Customer name fallback on order lists

**Files:**

- `apps/admin`: the `GET /orders` handler. When `recipientName` is null, batch-resolve customers through Identity (the existing customer read; add a tenant-scoped `findByIds` if needed).
- `customerName` = the customer's name if set, else their email, else null.

**Tests:**

- one Identity read per page;
- a guest with an email shows the email;
- an unknown customer stays null.

Commit: `feat(orders): show the customer's name or email when an order has no recipient name`.

---

### Task 4: Home dashboard like Shopify

**Files:**

- `apps/admin-web/src/app/page.tsx` and `components/dashboard/*`;
- `lib/api/analytics.ts` (new);
- messages and tests;
- **delete** `src/data/dashboard.ts`, `src/data/recent-orders.ts` and their tests.

**Layout:**

- **Header:** the title "Home" / "الرئيسية", plus the date-range picker. Presets:
  - Today / النهارده, Yesterday / امبارح;
  - Last 7 days / آخر 7 أيام (the default), Last 30 days / آخر 30 يوم;
  - This month / الشهر ده.

  The range lives in the URL (`?range=7d`) so a reload keeps it. **The Filters button is removed.**

- **4 KPI cards:**
  1. Total sales / إجمالي المبيعات;
  2. Orders / الطلبات;
  3. Average order value / متوسط قيمة الطلب. Each of these three shows the value, the change badge vs the previous period ("vs {prev range}" / "مقارنة بـ {prev range}"), and a sparkline from `daily`.
  4. **Orders to fulfill / طلبات محتاجة تجهيز**: the all-time count, linking to `/orders?fulfillment=unfulfilled` (add that filter to the orders list if missing; a small server-side filter on the 3B status). No sparkline.
- **The sales chart** ("Total sales over time" / "المبيعات على مدار الوقت"):
  - the current range as the line;
  - the previous range dashed for comparison;
  - the x-axis as dates in the store timezone, the y-axis as money;
  - every day present, including zeros.
  - Keep the existing chart component if it renders real series; otherwise adapt it.
- **Top products** ("Top products by units sold" / "أكتر المنتجات مبيعًا"): image (or placeholder), title, variant title, units and sales. Empty: "No sales in this period" / "مفيش مبيعات في الفترة دي".
- **Recent orders** (the latest 5, regardless of the range):
  - number, customer name (Task 3), the payment and fulfillment badges (the 3B components), relative time and total;
  - "View all".
  - **The old "Processing" / initials avatar goes.**
- **The note when `otherCurrencyOrders > 0`:** "{n} orders in other currencies aren't included." / "فيه {n} طلبات بعملة تانية مش محسوبة."
- **Remove:**
  - the "Reporting unavailable" banner;
  - every "Demo" badge;
  - conversion rate;
  - sales by channel (inventory action `remove`).
- **API error:** each card shows "Couldn't load — Try again" (a button that re-requests); never fallback numbers.

**Tests:**

- Zero data shows `0` / formatted zero money and empty states, with no "Demo" text anywhere (assert the dictionary has no "demo" keys used).
- The change badge math (up, down, `—`, "New").
- The range preset sets the URL.
- The chart receives every day.
- Recent orders shows the 3B badges.
- The error state.

Commit: `feat(admin-web): real home dashboard like shopify, zeros included`.

---

### Task 5: The rest of the inventory

Apply every non-Home row from Task 1:

- **Analytics page:** reuse Task 2's data (sales, orders, AOV, the chart, top products) with the same picker, and remove the rest.
- **Other pages:** `remove` or `empty`, as the table says.

One commit per page group, each with tests that no sample value renders.

Commits: `feat(admin-web): real analytics page, no sample numbers`, plus one per remaining group, as `fix(admin-web): drop sample data from {page}`.

---

### Task 6: Docs, gates, push

**Close:** any gap about demo or unwired dashboard numbers (search both registers).

**Open:**

- **Medium:** "No storefront sessions or conversion rate. Visits aren't counted yet, so Home shows no conversion card."
- **Low:** "Total sales nets full refunds only (partial refunds: G-132)."
- **Low:** "Orders in a currency other than the store currency are excluded from analytics, not converted."

**Gates, sequentially:**

1. the package suites (orders, identity, admin, admin-web);
2. `-r typecheck`;
3. `-r lint`, with no new warnings in touched files;
4. `pnpm arch`.

There is no migration, so **push** when green. Commit the docs, including this plan: `docs(analytics): record plan 3d, home shows real numbers`. Then push `morbeh/w0-w17-w12` and send the Arabic report:

- the commits and test counts;
- the inventory table translated (page, what was fake, and what happened to it);
- how to check: open Home with "Today" (zeros if no orders today), then "Last 30 days", then compare with the orders list.

## Inventory

Searched `apps/admin-web/src` (app, components, lib, data, messages) for `demo`, `sample`, `fake`, `dummy`, `hard-coded`, `Reporting unavailable`, `@/data/*` imports and literal money/count figures. Demo data lives only in `src/data/dashboard.ts` and its Home consumers; every other page already reads a real API and says "never falls back to demo data" in its doc comment.

| Page/component                                                                                                                                          | What is fake                                                                                                                                                                    | Real source available?                                                          | Action                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Home, KPI Total sales                                                                                                                                   | Reads Finance income statement but **falls back to the demo `$128,340.00` (+18.2%)** on any error; no sparkline                                                                 | Yes: `orders.orders` totals (Task 2)                                            | `real` (no fallback; error state with "Try again")                                                                                  |
| Home, KPI Orders                                                                                                                                        | Hard-coded `1,482`, `+12.4%`, fake trend                                                                                                                                        | Yes: count of counted orders (Task 2)                                           | `real`                                                                                                                              |
| Home, KPI Average order value                                                                                                                           | Hard-coded `$86.64`, `+8.6%`, fake trend                                                                                                                                        | Yes: sales / orders (Task 2)                                                    | `real`                                                                                                                              |
| Home, KPI Conversion rate                                                                                                                               | Hard-coded `2.34%`, `+6.1%`, fake trend                                                                                                                                         | **No**: storefront visits are not counted                                       | `remove`                                                                                                                            |
| Home, KPI Orders to fulfill                                                                                                                             | Does not exist yet                                                                                                                                                              | Yes: unfulfilled orders via the 3B derivation (Task 2)                          | `real` (new card)                                                                                                                   |
| Home, Sales overview chart                                                                                                                              | `SALES_SAMPLE` seven fake days, shifted to look current                                                                                                                         | Yes: `daily[]` (Task 2)                                                         | `real` (current vs previous range)                                                                                                  |
| Home, Top products                                                                                                                                      | Five fake "Morbeh" products with fake units, sales, **views, conversion and stock**                                                                                             | Units and sales: yes (Task 2). Views, conversion: no. Stock: not a sales figure | `real` for units and sales; `remove` views, conversion, stock                                                                       |
| Home, Sales by channel                                                                                                                                  | `DEMO_CHANNELS` with fake shares                                                                                                                                                | **No**: orders carry no channel dimension                                       | `remove`                                                                                                                            |
| Home, Recent orders                                                                                                                                     | Real `GET /orders`, but name is the placeholder "Customer 149F27", initials avatar, and a 3-bucket "Processing/Paid/Refunded" status that ignores the 3B statuses               | Yes: Identity customer name or email (Task 3); 3B badges                        | `real`                                                                                                                              |
| Home, header and banners                                                                                                                                | "Reporting unavailable" and "Demo"/"mixed" provenance badge, `demoExplanation`/`partialExplanation` notes, per-card "Demo" tag, **Filters** button, fixed trailing-7-day period | Date-range picker: yes (Task 4)                                                 | `remove` badges, banners and Filters; `real` range picker                                                                           |
| `messages/en.ts` and `ar.ts`: `data.demo*`, `data.partialExplanation`, `data.demoTag`, `sales/topProducts/channels.demoExplanation`                     | Copy that excuses missing backends                                                                                                                                              | n/a                                                                             | `remove`                                                                                                                            |
| `src/data/dashboard.ts`, `src/data/recent-orders.ts` and their tests                                                                                    | The demo payload, its provenance types and the 3-bucket status mapping                                                                                                          | n/a                                                                             | `remove` (delete)                                                                                                                   |
| Analytics page (`/analytics`)                                                                                                                           | No numbers. It is a metric/dimension **catalog** with a note that no query runs, so it shows no sales, orders or AOV                                                            | Yes: Task 2 sales summary                                                       | `real` (sales, orders, AOV, chart, top products, same picker); `remove` the catalog tables and the "queries are not connected" note |
| Marketing page (`/marketing`)                                                                                                                           | No numbers; already an honest "waits for a real Marketing context" page                                                                                                         | n/a                                                                             | none (already `empty`)                                                                                                              |
| Every other page (orders, products, customers, finance, inventory, reviews, experiments, feature flags, locales, notifications, settings, and the rest) | Nothing found                                                                                                                                                                   | Already real                                                                    | none                                                                                                                                |

## Done criteria

- **Home** shows only real numbers, with zeros as zeros, a period comparison, a full-day chart, top products, and recent orders with names and Shopify badges.
- **No "Demo", sample or fake number** remains anywhere in the admin.
- **Every gate is green.** The security assertions are unchanged.

## Outcome (2026-10-13)

Commits, in order: the inventory above; `feat(orders): real sales summary for the dashboard, computed from orders`;
`feat(orders): show the customer's name or email when an order has no recipient name`;
`feat(orders): range presets and an unfulfilled filter for the home dashboard`;
`feat(admin-web): real home dashboard like shopify, zeros included`;
`feat(admin-web): real analytics page, no sample numbers`; and this docs commit. No migration.

Where the build departed from the text above, and why:

- **Orders to fulfill** is not derived inside `services/orders`: fulfillment status belongs to the Fulfillment
  context and the Plan 3B function lives in `apps/admin`. The read model returns the open order ids (never
  cancelled, not closed) and the route counts the ones the Plan 3B derivation calls unfulfilled, in batches of 500.
- **`to` is exclusive**, so "Today" is `from` today, `to` tomorrow. The route also takes `range=today|yesterday|7d|30d|month`,
  resolved against today in the shop's own time zone, because admin-web cannot know the shop's "today".
- **The bad-range 400** comes from the route handler: the platform maps every schema failure to 422.
- **The shop's time zone and currency** are read through `TenancyAdminController.getStoreRegion` (guarded `orders:read`),
  not by injecting Tenancy into the orders controller, which the `TENANT_MODE=multi` boot guard forbids (no second pin exemption).
- **A guest is named by email**: guest checkout stores the email's local part as the customer's name (a placeholder).
- **`GET /orders?fulfillment=unfulfilled`** exists so the card links to a list that matches its count.
- **Top products** carry `imageUrl` (the name order lines already use) instead of a `featuredImage` object.
- **The Analytics catalog** (metric and dimension tables) was removed along with its unused client.
- New gaps G-145 (no visits, no conversion), G-146 (full refunds only), G-147 (other currencies excluded); the T5.13 blocker is closed.
